import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DomainEvents } from '../events/domain-events';
import { IntegrationPolicy } from './integration-policy';
import { ConnectionRegistry } from './connection-registry';
import { IncomingPipeline } from './incoming-pipeline';
import { ReceiveMetrics,reference } from './receive-metrics';
import { storageError } from './storage-diagnostics';
import { SOCKET_FACTORY, WHATSAPP_STATE, codedError, errorCode, type ConnectionState, type ProviderSocket, type SocketFactory, type StateStore } from './contracts';

interface Runtime {
  generation: number; state: ConnectionState; attempts: number; stop: boolean;
  socket?: ProviderSocket; opening?: Promise<void>; closing?: Promise<void>; timer?: NodeJS.Timeout;
  allowPairing?:boolean;
  updates?:Promise<void>; recovering?:boolean; authIssue?:string|null;
  connectedBefore?:boolean; pairingObserved?:boolean; restartAttempts?:number;
  metrics: ReceiveMetrics; listeners: Array<() => void>; qr?: string; qrExpiresAt?: number; qrTimer?: NodeJS.Timeout;
}
@Injectable()
export class ConnectionManager implements OnModuleDestroy {
  private readonly sessions = new Map<string, Runtime>();
  private readonly logger = new Logger('WhatsAppIntegration');
  private destroyed = false;
  private readonly bootId=randomUUID();
  private metrics(id:string,generation:number){return new ReceiveMetrics(event=>this.logger.log(JSON.stringify({...event,connectionRef:reference(id),generation,bootId:this.bootId})));}
  constructor(private readonly policy: IntegrationPolicy, private readonly registry: ConnectionRegistry,
    @Inject(SOCKET_FACTORY) private readonly factory: SocketFactory,
    @Inject(WHATSAPP_STATE) private readonly store: StateStore,
    private readonly incoming: IncomingPipeline, private readonly events: DomainEvents) {}
  private runtime(id: string): Runtime {
    let value = this.sessions.get(id);
    if (!value) {
      value = { generation:0,state:'disconnected',attempts:0,stop:false,listeners:[],
        metrics: this.metrics(id,0) };
      this.sessions.set(id,value);
    }
    return value;
  }
  status(id:string) {
    const value=this.runtime(id), open=value.socket?.isOpen() ?? false, buffering=value.socket?.isBuffering() ?? null;
    const queue=this.incoming.stats(id),phases=Object.values(value.metrics.history);
    return { id, connectionId:id, status:value.state==='manually_disconnected'?'disconnected':value.state,
      state:value.state, websocketOpen:open, bootId:this.bootId,generation:value.generation, reconnectAttempts:value.attempts,
      restartAttempts:value.restartAttempts??0, authenticationIssue:value.authIssue??null,
      requiresPairingRecovery:!!value.authIssue&&['logged_out','credentials_rejected','pairing_incomplete','session_error','reconnect_budget_exhausted'].includes(value.authIssue),
      providerEnabled:this.policy.enabled,sendingEnabled:this.policy.allowSending, buffering, receivedPendingNotifications:value.metrics.receivedPendingNotifications,
      syncComplete:open && buffering===false && value.metrics.receivedPendingNotifications&&!phases.some(phase=>phase.status==='paused'),
      offlineTerminalAt:value.metrics.offlineTerminalAt, lastEvent:value.metrics.lastEvent,lastError:value.metrics.lastError,
      counters:{...value.metrics.counters},lastPersistenceAt:value.metrics.lastPersistenceAt,
      queue,lastTransportAt:value.metrics.lastTransportAt,lastMessageReceivedAt:value.metrics.lastMessageAt,lastRecentPersistenceAt:value.metrics.lastRecentPersistenceAt,
      historySync:{phases:{...value.metrics.history},state:!phases.length?'not_observed':phases.some(p=>p.status==='paused')?'paused':phases.every(p=>p.explicit)?'observed_phases_complete':'inferred_completion'},
      communicationRestriction:value.metrics.communicationRestriction,
      receivingObserved:!!value.metrics.lastRecentPersistenceAt,
      receiveHealth: !open?'disconnected':queue.retained||queue.retrying||queue.overflow||queue.retainedMappings||queue.failedReceipts?'receive_degraded':buffering!==false||!value.metrics.receivedPendingNotifications||phases.some(p=>p.status==='paused')?'sync_pending':value.metrics.lastError?'receive_degraded':value.metrics.lastRecentPersistenceAt?'receiving_observed':'ready_waiting_for_activity' };
  }
  async inspectStatus(id:string){
    const value=this.runtime(id);
    if(!value.socket&&!value.opening&&!value.recovering){
      const intent=await this.store.get<{blocked?:boolean;reason?:string}>('intent',id);
      value.authIssue=intent?.blocked?intent.reason??'session_error':value.authIssue;
    }
    return this.status(id);
  }
  readySocket(id:string,sending=false):ProviderSocket {
    const value=this.runtime(id);
    if(value.recovering)throw codedError('PAIRING_RECOVERY_IN_PROGRESS',409);
    if(!this.policy.enabled||value.stop||value.state!=='connected'||!value.socket?.isOpen())throw codedError('MESSAGE_PROVIDER_UNAVAILABLE');
    if(sending&&value.metrics.communicationRestriction?.active)throw codedError('WHATSAPP_COMMUNICATION_RESTRICTED',423);
    return value.socket;
  }
  /** Explicit operator retry uses the same identity and replays the sealed WAL.
   * Auto-restore never clears a storage block, and pairing stays forbidden. */
  async retryStorage(id:string){
    const value=this.runtime(id);
    if(value.socket||value.opening||value.closing||value.recovering||value.timer)throw codedError('DISCONNECT_BEFORE_STORAGE_RETRY',409);
    return this.start(id,false,true);
  }
  async start(id:string,allowPairing=false,retryStorage=false,automatic=false):Promise<ReturnType<ConnectionManager['status']>> {
    if(!this.policy.enabled)throw codedError('WHATSAPP_INTEGRATION_DISABLED');
    if(this.destroyed)throw codedError('WHATSAPP_SHUTTING_DOWN');
    const value=this.runtime(id);
    if(value.recovering)throw codedError('PAIRING_RECOVERY_IN_PROGRESS',409);
    if(value.opening){await value.opening;return this.status(id);}
    // Reserve synchronously, before the first await: concurrent requests share
    // the entire preparation as well as the socket construction.
    value.stop=false;
    value.opening=(async()=>{
      if(value.closing)await value.closing;
      const row=await this.registry.find(id);
      if(!row.isActive)throw codedError('WHATSAPP_CONNECTION_INACTIVE',409);
      if(value.stop||this.destroyed)return;
      if(value.socket)return;
      if(value.timer){clearTimeout(value.timer);value.timer=undefined;}
      const intent=await this.store.get<{restore?:boolean;manual?:boolean;blocked?:boolean;reason?:string}>('intent',id);
      if(automatic&&(intent?.manual||intent?.restore===false)){value.stop=true;value.state='disconnected';return;}
      const storageRetry=retryStorage&&intent?.blocked&&intent.reason==='storage_failure';
      if(retryStorage&&!storageRetry)throw codedError('STORAGE_RETRY_NOT_APPLICABLE',409);
      if(intent?.blocked&&!storageRetry){value.authIssue=intent.reason??'session_error';throw codedError('SESSION_INTERVENTION_REQUIRED',409);}
      if(allowPairing&&!this.policy.allowPairing)throw codedError('PAIRING_NOT_AUTHORIZED',403);
      const budget=await this.store.get<{attempts:number;restarts?:number}>('reconnect-budget',id);
      if(budget){if(!Number.isInteger(budget.attempts)||budget.attempts<0||budget.attempts>10)throw codedError('RECONNECT_BUDGET_INVALID');value.attempts=Math.max(value.attempts,budget.attempts);}
      if(budget?.restarts!==undefined){if(!Number.isInteger(budget.restarts)||budget.restarts<0||budget.restarts>10)throw codedError('RECONNECT_BUDGET_INVALID');value.restartAttempts=Math.max(value.restartAttempts??0,budget.restarts);}
      if(!storageRetry)await this.store.put('intent',id,{restore:true,manual:false});
      const history=await this.store.get<{connectedAt?:string}>('session-history',id);
      const authSelection=await this.store.get('session-auth',id);
      value.connectedBefore=!!history?.connectedAt||(!authSelection&&!!row.lastConnectedAt);
      value.authIssue=null;
      if(!value.stop)await this.open(id,value,allowPairing);
      if(storageRetry&&!value.stop&&value.socket){
        try{await this.store.put('intent',id,{restore:true,manual:false});}
        catch(error){const failure=storageError('AUTH_STORAGE_FAILED',error,{operation:'restore_intent'});await this.fatal(id,value,failure);throw failure;}
      }
    })().finally(()=>{value.opening=undefined;});
    await value.opening;
    return this.status(id);
  }
  private async open(id:string,value:Runtime,allowPairing:boolean) {
    const generation=++value.generation;
    value.allowPairing=allowPairing;
    value.state=value.attempts?'reconnecting':'connecting';
    value.metrics=this.metrics(id,generation);
    value.metrics.event(value.attempts?'reconnect_attempt':'connection_start');
    const epoch=Date.now();
    try {
      const socket=await this.factory.open(id,allowPairing);
      if(value.stop||this.destroyed||value.generation!==generation){await socket.close();await this.factory.release(id);return;}
      value.socket=socket;
      const current=()=>value.socket===socket&&value.generation===generation&&!value.stop&&!this.destroyed;
      const fail=(error:unknown)=>{if(value.generation===generation&&!value.stop)void this.fatal(id,value,error);};
      const on=(event:string,listener:(data:any)=>void,transport=false)=>{
        const emitter=transport?socket.transport:socket.events;if(!emitter)return;
        emitter.on(event,listener);value.listeners.push(()=>emitter.off(event,listener));
      };
      on('connection.update',(update)=>{if(current()){
        // Observations must take effect immediately, especially send restrictions.
        // Only lifecycle actions that await I/O go through the transition queue.
        if(update.reachoutTimeLock)value.metrics.restriction(update.reachoutTimeLock);
        if(update.receivedPendingNotifications===true){value.metrics.receivedPendingNotifications=true;value.metrics.syncCompletedAt=new Date().toISOString();}
        // Snapshot the event and serialize lifecycle transitions, independently
        // of auth writes. Duplicate closes cannot consume two retry slots.
        const next=(value.updates??Promise.resolve()).then(()=>this.connectionUpdate(id,value,socket,update));
        value.updates=next.catch(async(error)=>{if(value.generation===generation&&!value.stop)await this.fatal(id,value,error);});
      }});
      if(!socket.managesCredentials)on('creds.update',(update)=>{if(current())void socket.saveCredentials(update).catch(fail);});
      on('messages.upsert',(batch)=>{if(current())void this.incoming.accept(id,batch,socket,epoch,value.metrics).catch(fail);});
      on('messaging-history.set',(batch)=>{if(current())void this.incoming.history(id,batch,socket,epoch,value.metrics).catch(fail);});
      on('lid-mapping.update',(mapping)=>{if(current())void this.incoming.mappings(id,[mapping],value.metrics).catch(fail);});
      on('messaging-history.status',(update)=>{if(current())try{value.metrics.historyStatus(update);this.events.emit({type:'connection.changed',connectionId:id});}catch(error){value.metrics.error('history_status_invalid',error);}});
      on('messages.update',(updates)=>{if(current())void this.incoming.updates(id,updates,value.metrics).catch(fail);});
      on('message-receipt.update',(updates)=>{
        if(!current())return;
        const mapped=(updates??[]).map((v:any)=>({key:v.key,update:{status:v.receipt?.readTimestamp?4:v.receipt?.receiptTimestamp?3:undefined}}));
        void this.incoming.updates(id,mapped,value.metrics).catch(fail);
      });
      on('CB:message',()=>{if(current())value.metrics.event('transport_message');},true);
      on('CB:ib,,offline',()=>{if(current()){value.metrics.offlineTerminalAt=new Date().toISOString();value.metrics.event('offline_terminal');}},true);
      on('error',(error)=>{if(current())value.metrics.error('socket_error',error);},true);
      if(socket.diagnostics){const listener=(error:any)=>{if(current()){
        if(error.code==='AUTH_STORAGE_FAILED'){void this.fatal(id,value,error);return;}
        value.metrics.error(error.category==='sync_initial_queries'?'sync_initial_queries':'provider_error',error);
      }};socket.diagnostics.on('diagnostic',listener);value.listeners.push(()=>socket.diagnostics!.off('diagnostic',listener));}
      const earlyFailure=socket.authStorageFailure?.();if(earlyFailure){await this.fatal(id,value,earlyFailure);return;}
      value.metrics.event('listeners_registered');
      this.events.emit({type:'connection.changed',connectionId:id});
      await this.incoming.recover(id,socket,value.metrics);
      await this.incoming.recoverReceipts(id);
    } catch(error) {
      value.state='error';value.metrics.error('connection_start_failed',error);
      const code=errorCode(error);
      value.authIssue=code==='SESSION_PAIRING_REQUIRED'||code==='EXISTING_SESSION_NOT_FOUND'?'pairing_incomplete':value.authIssue;
      if(value.socket)await this.closeSocket(id,value);
      throw error;
    }
  }
  private async connectionUpdate(id:string,value:Runtime,socket:ProviderSocket,update:any) {
    if(value.socket!==socket||value.stop)return;
    if(update.isNewLogin===true){
      value.pairingObserved=true;value.state='connecting';value.qr=undefined;value.qrExpiresAt=undefined;
      if(value.qrTimer)clearTimeout(value.qrTimer);
      value.metrics.event('pairing_observed');
    }
    if(typeof update.qr==='string') {
      if(!value.allowPairing)throw codedError('SESSION_PAIRING_REQUIRED',409);
      const encoded=await this.factory.qrDataUrl(update.qr);
      if(value.socket!==socket||value.stop)return;
      value.state='qr_ready';value.qr=encoded;value.qrExpiresAt=Date.now()+60000;
      if(value.qrTimer)clearTimeout(value.qrTimer);
      value.qrTimer=setTimeout(()=>{value.qr=undefined;value.qrExpiresAt=undefined;},60000);value.qrTimer.unref();
      value.metrics.event('qr_available');
    }
    if(update.connection==='open') {
      await this.store.put('session-history',id,{connectedAt:new Date().toISOString()});
      if(value.stop||value.socket!==socket)return;
      value.connectedBefore=true;value.authIssue=null;
      value.attempts=0;value.restartAttempts=0;value.allowPairing=false;value.pairingObserved=false;
      await this.store.put('reconnect-budget',id,{attempts:0,restarts:0});
      if(value.stop||value.socket!==socket)return;
      value.state='connected';value.qr=undefined;value.qrExpiresAt=undefined;
      value.metrics.event('connection_open');
      await this.incoming.recover(id,socket,value.metrics,false);
    }
    if(update.connection==='close') {
      value.metrics.error('connection_close',update.lastDisconnect?.error);
      const code=errorCode(update.lastDisconnect?.error);
      await this.closeSocket(id,value);
      if(value.stop||this.destroyed)return;
      const permanent=[401,403,411,440,500].includes(Number(code));
      if(permanent) {
        value.state=Number(code)===401?'disconnected':'error';
        value.authIssue=Number(code)===401?(value.connectedBefore?'logged_out':socket.authentication?.().hasIdentity?'credentials_rejected':'pairing_incomplete'):'session_error';
        await this.store.put('intent',id,{restore:false,blocked:true,reason:value.authIssue});
      } else {
        await this.scheduleReconnect(id,value,Number(code)===515);
      }
    }
    this.events.emit({type:'connection.changed',connectionId:id});
  }
  private async scheduleReconnect(id:string,value:Runtime,restart=false) {
        if(value.stop||this.destroyed)return;
        // A 515 is the expected pairing handoff, with its own bounded budget.
        const budget=restart?(value.restartAttempts??0):value.attempts;
        if(budget<this.policy.reconnectLimit){
          const delay=restart?0:Math.min(this.policy.reconnectBaseMs*2**budget,this.policy.reconnectMaxMs);
          if(restart)value.restartAttempts=budget+1;else value.attempts++;
          value.state='reconnecting';
          await this.store.put('reconnect-budget',id,{attempts:value.attempts,restarts:value.restartAttempts??0});
          const generation=value.generation,pairingAllowed=value.allowPairing===true;
          value.timer=setTimeout(()=>{value.timer=undefined;void (async()=>{
            // A close can arrive while initial ingress recovery still keeps
            // start() pending. Do not let that promise swallow the restart.
            await value.opening?.catch(()=>undefined);
            if(value.generation===generation&&!value.stop&&!this.destroyed)await this.start(id,pairingAllowed,false,true);
          })().catch((e)=>{
            value.metrics.error('reconnect_failed',e);value.state='error';
            if(this.transient(e))void this.scheduleReconnect(id,value).catch(error=>this.fatal(id,value,error));
            this.events.emit({type:'connection.changed',connectionId:id});
          });},delay);value.timer.unref();
        }else{value.state='error';value.authIssue='reconnect_budget_exhausted';await this.store.put('intent',id,{restore:false,blocked:true,reason:value.authIssue});}
  }
  private transient(error:unknown) {
    return ['ECONNRESET','ECONNREFUSED','ETIMEDOUT','EAI_AGAIN','ENETUNREACH','EHOSTUNREACH'].includes(String(errorCode(error)));
  }
  private async closeSocket(id:string,value:Runtime) {
    if(value.closing)return value.closing;
    const socket=value.socket;value.socket=undefined;
    this.incoming.suspend(id);
    for(const off of value.listeners.splice(0))off();
    value.qr=undefined;value.qrExpiresAt=undefined;
    if(value.qrTimer)clearTimeout(value.qrTimer);
    value.closing=(async()=>{try{if(socket)await socket.close();}finally{await this.factory.release(id);}})().finally(()=>{value.closing=undefined;});
    return value.closing;
  }
  private async fatal(id:string,value:Runtime,error:unknown) {
    if(value.stop)return;
    value.metrics.error('connection_critical_failure',error);value.stop=true;value.state='error';
    if(value.timer)clearTimeout(value.timer);
    try{await this.closeSocket(id,value);}catch(e){value.metrics.error('socket_close_failed',e);}
    const code=errorCode(error);
    value.authIssue=code==='AUTH_STORAGE_FAILED'?'storage_failure':code==='SESSION_PAIRING_REQUIRED'?'pairing_incomplete':'critical_failure';
    try{await this.store.put('intent',id,{restore:false,blocked:true,reason:value.authIssue});}catch(e){value.metrics.error('restore_intent_failed',e);}
    this.events.emit({type:'connection.changed',connectionId:id});
  }
  async stop(id:string,manual=true) {
    const value=this.runtime(id);value.stop=true;
    if(value.timer){clearTimeout(value.timer);value.timer=undefined;}
    let persistenceError:unknown;
    if(manual)try{const previous=await this.store.get<Record<string,unknown>>('intent',id);await this.store.put('intent',id,{...previous,restore:false,manual:true});}catch(error){persistenceError=error;}
    if(value.opening)await value.opening.catch(()=>undefined);
    await value.updates;
    await this.closeSocket(id,value);
    if(persistenceError){value.state='error';throw persistenceError;}
    value.state=manual?'manually_disconnected':'disconnected';
    value.metrics.event(manual?'manual_disconnect':'process_stop');
    this.events.emit({type:'connection.changed',connectionId:id});return this.status(id);
  }
  qr(id:string) {const v=this.runtime(id);return {connectionId:id,status:this.status(id).status,qrCodeDataUrl:v.qrExpiresAt&&v.qrExpiresAt>Date.now()?v.qr??null:null,expiresAt:v.qrExpiresAt?new Date(v.qrExpiresAt).toISOString():null};}
  /** Explicit admin action. Old auth is never deleted or overwritten: publish
   * a new auth namespace only after a complete encrypted archive is committed. */
  async recoverPairing(id:string,confirmation:string,acknowledge:boolean,actorId:string){
    if(confirmation.toLowerCase()!==id.toLowerCase()||acknowledge!==true)throw codedError('PAIRING_CONFIRMATION_REQUIRED',400);
    if(!this.policy.enabled||!this.policy.allowPairing)throw codedError('PAIRING_NOT_AUTHORIZED',403);
    const value=this.runtime(id);
    if(value.recovering||value.opening||value.socket||value.timer||value.closing)throw codedError('DISCONNECT_BEFORE_PAIRING_RECOVERY',409);
    if(!this.factory.withSessionLock)throw codedError('PAIRING_RECOVERY_UNAVAILABLE');
    value.recovering=true;value.stop=true;
    try{
      await value.updates;
      const row=await this.registry.find(id);if(!row.isActive)throw codedError('WHATSAPP_CONNECTION_INACTIVE',409);
      return await this.factory.withSessionLock(id,async()=>{
        const archiveId=randomUUID(),authId=randomUUID(),previous=await this.store.get<{authId:string}>('session-auth',id);
        const active=previous?.authId??id,manifest={connectionId:id,actorId,at:new Date().toISOString(),previous,authId,records:0,complete:false};
        await this.store.put('pairing-archives',archiveId,manifest);
        // Each archived record stays under the encrypted store's per-record limit.
        for(const entry of await this.store.entries('auth'))if(entry.key.startsWith(active+'|')){
          await this.store.put('pairing-auth',archiveId+'|'+entry.key,entry.value);manifest.records++;
        }
        const controls:Record<string,unknown>={};
        for(const namespace of ['intent','reconnect-budget','session-history','auth-batches']){
          controls[namespace]=await this.store.get(namespace,namespace==='auth-batches'?active:id);
        }
        await this.store.put('pairing-controls',archiveId,controls);
        await this.store.put('pairing-archives',archiveId,{...manifest,complete:true});
        // Fail closed if interrupted after this point. Previous auth and archive
        // remain readable; an incomplete recovery never grants automatic restore.
        await this.store.put('intent',id,{restore:false,blocked:true,reason:'pairing_recovery_in_progress',archiveId});
        try{
          await this.store.put('session-auth',id,{authId,archiveId});
          await this.store.put('reconnect-budget',id,{attempts:0,restarts:0});
          await this.store.put('session-history',id,{previousArchiveId:archiveId});
          await this.store.put('intent',id,{restore:false,manual:true,blocked:false,archiveId});
        }catch(error){value.authIssue='storage_failure';throw codedError('PAIRING_RECOVERY_STORAGE_FAILED');}
        value.authIssue=null;value.attempts=0;value.restartAttempts=0;value.connectedBefore=false;
        value.pairingObserved=false;value.allowPairing=false;value.state='disconnected';
        this.events.emit({type:'connection.changed',connectionId:id});
        return {...this.status(id),archiveId};
      });
    }finally{value.recovering=false;}
  }
  async restore() {
    if(!this.policy.enabled||!this.policy.autoRestore)return;
    for(const row of await this.registry.list()) {
      if(!row.isActive)continue;
      const value=this.runtime(row.id);
      try {
        const intent=await this.store.get<any>('intent',row.id);
        if(intent?.manual||intent?.blocked||intent?.restore===false){
          value.authIssue=intent.blocked?intent.reason??'session_error':null;continue;
        }
        // Legacy rows may predate persisted intent. Respect recorded operator
        // disconnection evidence before considering their saved authentication.
        if(!intent&&(row.status==='manually_disconnected'||(row.lastDisconnectedAt&&(!row.lastConnectedAt||new Date(row.lastDisconnectedAt)>=new Date(row.lastConnectedAt)))))continue;
        if(this.factory.hasAuthenticatedSession&&!await this.factory.hasAuthenticatedSession(row.id)){
          value.authIssue='pairing_incomplete';continue;
        }
        await this.start(row.id,false,false,true);
      } catch(error) {
        value.state='error';value.metrics.error('restore_failed',error);
        if(this.transient(error))try{await this.scheduleReconnect(row.id,value);}catch(failure){await this.fatal(row.id,value,failure);}
      } finally { this.events.emit({type:'connection.changed',connectionId:row.id}); }
    }
  }
  async idle(id:string){await this.runtime(id).opening;await this.runtime(id).updates;await this.incoming.wait(id);}
  async onModuleDestroy(){this.destroyed=true;for(const[id,v]of this.sessions){if(v.timer)clearTimeout(v.timer);try{await this.stop(id,false);}catch(error){v.metrics.error('shutdown_failed',error);}}}
}
