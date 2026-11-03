import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { MessagesService, MessageReceiptsService } from '../messages/messages.service';
import { MessageFilesService } from '../messages/message-files.service';
import { FilePolicy } from '../messages/file-policy';
import { DomainEvents } from '../events/domain-events';
import { collectMedia, normalizeProviderMessage,normalizeJid } from './normalize-message';
import { IntegrationPolicy } from './integration-policy';
import { ReceiveMetrics, reference } from './receive-metrics';
import { codedError,errorCode, WHATSAPP_STATE,type StateStore,type ProviderSocket } from './contracts';
import { cloneState,stateReplacer } from './state-codec';
import { IdentityResolver } from './identity-resolver';
import { WhatsappConversation } from '../whatsapp-conversations/entities/whatsapp-conversation.entity';
import { WhatsappMessage } from '../whatsapp-conversations/entities/whatsapp-message.entity';
interface PendingMessage {connectionId:string;type:string;epochAt:number;raw:any;requestedHistory:boolean;attempts:number;
  retained?:boolean;createdAt?:string;nextAttemptAt?:number;lastError?:number|string|null;reason?:string;sequence?:number}
interface Recovery {socket:ProviderSocket;metrics:ReceiveMetrics;timer?:NodeJS.Timeout;disabled:boolean}
@Injectable()
export class IncomingPipeline implements OnModuleDestroy {
  private readonly tails=new Map<string,Promise<void>>();
  private readonly reserved=new Map<string,number>();
  private readonly active=new Map<string,{type:string;started:number}>();
  private readonly contexts=new Map<string,Recovery>();
  private readonly counts=new Map<string,{pending:number;retained:number;retrying:number;lastScanAt:string}>();
  private readonly identities:IdentityResolver;
  private readonly mappingTasks=new Map<string,Set<Promise<void>>>();
  private readonly mappingCounts=new Map<string,number>();
  private sequence=0;
  private readonly overflows=new Map<string,number>();
  private readonly controlCounts=new Map<string,{pendingMappings:number;retainedMappings:number;pendingReceipts:number;failedReceipts:number}>();
  constructor(@Inject(WHATSAPP_STATE)private readonly store:StateStore,private readonly messages:MessagesService,
    private readonly files:MessageFilesService,private readonly receipts:MessageReceiptsService,private readonly policy:IntegrationPolicy,
    private readonly filePolicy:FilePolicy,private readonly database:DataSource,private readonly events:DomainEvents){this.identities=new IdentityResolver(store,database);}
  stats(id:string){const active=this.active.get(id),context=this.contexts.get(id),counts=this.counts.get(id);
    return {queuedOrProcessing:this.reserved.get(id)??0,mappingQueuedOrProcessing:this.mappingCounts.get(id)??0,active:active?{type:active.type,ageMs:Math.round(performance.now()-active.started)}:null,
      pending:counts?.pending??null,retained:counts?.retained??null,retrying:counts?.retrying??null,lastScanAt:counts?.lastScanAt??null,
      recoveryState:!counts?'not_observed':counts.retained||this.overflows.get(id)||this.controlCounts.get(id)?.retainedMappings||this.controlCounts.get(id)?.failedReceipts?'review_required':counts.retrying||context?.timer?'retry_pending':counts.pending||this.controlCounts.get(id)?.pendingMappings?'pending':'idle',
      overflow:this.overflows.get(id)??null,...this.controlCounts.get(id),retryScheduled:!!context?.timer,providerInternalQueue:'not_observable'};}
  private serial(id:string,work:()=>Promise<void>):Promise<void>{
    const next=(this.tails.get(id)??Promise.resolve()).catch(()=>undefined).then(work);this.tails.set(id,next);
    void next.finally(()=>{if(this.tails.get(id)===next)this.tails.delete(id);}).catch(()=>undefined);return next;
  }
  suspend(id:string){const context=this.contexts.get(id);if(context){context.disabled=true;if(context.timer)clearTimeout(context.timer);context.timer=undefined;}}
  onModuleDestroy(){for(const id of this.contexts.keys())this.suspend(id);}
  private attach(id:string,socket:ProviderSocket,metrics:ReceiveMetrics){
    const previous=this.contexts.get(id);if(previous?.socket===socket&&!previous.disabled)return previous;
    this.suspend(id);const context:Recovery={socket,metrics,disabled:false};this.contexts.set(id,context);return context;
  }
  private async refresh(id:string):Promise<PendingMessage[]> {
    const jobs=(await this.store.entries<PendingMessage>('pending')).filter(entry=>entry.value.connectionId===id).map(entry=>entry.value);
    this.overflows.set(id,(await this.store.entries<PendingMessage>('receive-overflow')).filter(entry=>entry.value.connectionId===id).length);
    const mappings=(await this.store.entries<any>('mapping-jobs')).filter(entry=>entry.value.connectionId===id),receipts=(await this.store.entries<any>('receipts')).filter(entry=>entry.value.connectionId===id);
    this.controlCounts.set(id,{pendingMappings:mappings.length,retainedMappings:mappings.filter(entry=>entry.value.retained).length,pendingReceipts:receipts.length,failedReceipts:receipts.filter(entry=>entry.value._retained).length});
    this.counts.set(id,{pending:jobs.length,retained:jobs.filter(job=>job.retained).length,retrying:jobs.filter(job=>!job.retained&&job.attempts>0).length,lastScanAt:new Date().toISOString()});return jobs;
  }
  private async schedule(id:string){
    const context=this.contexts.get(id);if(!context||context.disabled||context.timer||!context.socket.isOpen())return;
    const jobs=(await this.refresh(id)).filter(job=>!job.retained&&job.attempts>0);
    for(const entry of await this.store.entries<any>('mapping-jobs'))if(entry.value.connectionId===id&&!entry.value.retained&&entry.value.attempts>0)jobs.push(entry.value);
    for(const entry of await this.store.entries<any>('receipts'))if(entry.value.connectionId===id&&!entry.value._retained&&!entry.value._waitingForMessage&&entry.value._attempts>0)jobs.push({...entry.value,nextAttemptAt:entry.value._nextAttemptAt});
    if(!jobs.length)return;
    const delay=Math.max(1,Math.min(...jobs.map(job=>(job.nextAttemptAt??Date.now())-Date.now())));
    context.timer=setTimeout(()=>{context.timer=undefined;if(this.contexts.get(id)!==context||context.disabled||!context.socket.isOpen())return;
      void this.recover(id,context.socket,context.metrics,false).catch(error=>{context.metrics.error('recovery_scan_failed',error);context.disabled=true;});
    },delay);context.timer.unref();
  }
  async mappings(id:string,pairs:any[],metrics:ReceiveMetrics):Promise<void>{
    if(!Array.isArray(pairs)||pairs.length>4096)throw codedError('IDENTITY_BATCH_INVALID',422);const owned=cloneState(pairs);
    this.mappingCounts.set(id,(this.mappingCounts.get(id)??0)+owned.length);
    metrics.batch('mapping_batch_received','mapping',owned.length,'queued');
    // A history batch must not monopolize the message queue. Enqueue one pair
    // at a time so already-arrived notify events run between mapping jobs.
    let remaining=owned.length;
    const work=(async()=>{try{for(const pair of owned){await this.serial(id,async()=>{
      this.active.set(id,{type:'identity_mapping',started:performance.now()});
      try{
      if(await this.identities.known(id,pair?.lid,pair?.pn)){metrics.increment('identity_mapping_unchanged');return;}
      const key=id+'|'+reference(JSON.stringify(pair,stateReplacer)),previous=await this.store.get<any>('mapping-jobs',key),job=previous??{connectionId:id,pair,attempts:0};
      if(!job.retained)await this.applyMapping(key,job,metrics);
      }finally{remaining--;this.active.delete(id);this.mappingCounts.set(id,Math.max(0,(this.mappingCounts.get(id)??1)-1));}
    });}await this.serial(id,async()=>{await this.refresh(id);await this.schedule(id);});metrics.batch('mapping_batch_completed','mapping',owned.length,'completed');}
    finally{if(remaining)this.mappingCounts.set(id,Math.max(0,(this.mappingCounts.get(id)??remaining)-remaining));}})();
    const tasks=this.mappingTasks.get(id)??new Set<Promise<void>>();tasks.add(work);this.mappingTasks.set(id,tasks);
    try{await work;}finally{tasks.delete(work);if(!tasks.size)this.mappingTasks.delete(id);}
  }
  private async applyMapping(key:string,job:any,metrics:ReceiveMetrics){
    if((job.attempts??0)>=this.policy.recoveryLimit){await this.store.put('mapping-jobs',key,{...job,retained:true});return;}
    const attempts=(job.attempts??0)+1;await this.store.put('mapping-jobs',key,{...job,attempts});
    try{await this.identities.learn(job.connectionId,job.pair?.lid,job.pair?.pn);await this.store.remove('mapping-jobs',key);metrics.increment('identity_mapping_applied');}
    catch(error){metrics.error('identity_mapping_failed',error);await this.store.put('mapping-jobs',key,{...job,attempts,
      retained:attempts>=this.policy.recoveryLimit||[409,422].includes(Number((error as any)?.status)),code:errorCode(error),nextAttemptAt:Date.now()+Math.min(this.policy.recoveryBaseMs*2**(attempts-1),this.policy.recoveryMaxMs)});}
  }
  async history(id:string,batch:any,socket:ProviderSocket,epochAt:number,metrics:ReceiveMetrics){
    const owned=cloneState(batch);metrics.batch('history_batch_received','history',owned.messages?.length??0,'queued');if(owned.lidPnMappings)await this.mappings(id,owned.lidPnMappings,metrics);
    await this.accept(id,{type:'append',messages:owned.messages??[],requestId:'history'},socket,epochAt,metrics);
  }
  async accept(id:string,upsert:any,socket:ProviderSocket,epochAt:number,metrics:ReceiveMetrics):Promise<void>{
    if(!Array.isArray(upsert?.messages)||!['notify','append'].includes(upsert.type))throw codedError('INVALID_UPSERT');
    metrics.event('upsert_received');metrics.event(upsert.type==='notify'?'upsert_notify':'upsert_append');
    metrics.batch('upsert_batch_received',upsert.type,upsert.messages.length,'queued');
    const count=upsert.messages.length,reserved=this.reserved.get(id)??0;
    const owned=cloneState(upsert);
    if(count>this.policy.pendingLimit||reserved+count>this.policy.pendingLimit||Buffer.byteLength(JSON.stringify(owned,stateReplacer))>4*1024*1024){
      await this.preserveOverflow(id,owned,epochAt);metrics.error('receive_capacity_retained',codedError('RECEIVE_QUEUE_FULL'));throw codedError('RECEIVE_QUEUE_FULL');
    }
    this.reserved.set(id,reserved+count);this.attach(id,socket,metrics);
    return this.serial(id,async()=>{
      metrics.batch('upsert_batch_started',owned.type,owned.messages.length);
      const existing=(await this.store.entries<PendingMessage>('pending')).filter(entry=>entry.value.connectionId===id);
      const jobs:Array<{key:string;job:PendingMessage}>=[],keys=new Set(existing.map(entry=>entry.key));
      for(const raw of owned.messages){
        const original=typeof raw?.key?.id==='string'?raw.key.id:reference(JSON.stringify(raw,stateReplacer));
        const key=id+'|'+original+'|'+String(raw?.key?.remoteJid)+'|'+String(raw?.key?.fromMe);
        if(!keys.has(key)&&keys.size>=this.policy.pendingLimit){await this.preserveOverflow(id,owned,epochAt);throw codedError('RECEIVE_JOURNAL_FULL');}keys.add(key);
        const previous=await this.store.get<PendingMessage>('pending',key),improves=previous?.reason==='unsupported'&&!!raw.message;
        const job:PendingMessage=previous&&!improves?previous:{connectionId:id,type:owned.type,epochAt,raw,requestedHistory:owned.requestId!==undefined,
          attempts:0,createdAt:previous?.createdAt??new Date().toISOString(),sequence:previous?.sequence??++this.sequence};
        await this.store.put('pending',key,job);jobs.push({key,job});
      }
      for(const {key,job}of jobs)if(!job.retained)await this.process(key,job,socket,metrics);
      await this.applyRetainedReceipts(id,metrics);await this.refresh(id);await this.schedule(id);
      metrics.batch('upsert_batch_completed',owned.type,owned.messages.length,'completed');
    }).finally(()=>{this.reserved.set(id,(this.reserved.get(id)??count)-count);});
  }
  private async preserveOverflow(id:string,upsert:any,epochAt:number){
    for(const raw of upsert.messages){const key=id+'|'+reference(JSON.stringify(raw,stateReplacer));
      if(!await this.store.get('receive-overflow',key))await this.store.put('receive-overflow',key,{connectionId:id,type:upsert.type,epochAt,raw,
        requestedHistory:upsert.requestId!==undefined,attempts:0,retained:true,reason:'capacity_requires_review',createdAt:new Date().toISOString()});
    }
    this.overflows.set(id,(await this.store.entries<PendingMessage>('receive-overflow')).filter(entry=>entry.value.connectionId===id).length);
  }
  async recover(id:string,socket:ProviderSocket,metrics:ReceiveMetrics,force=true):Promise<void>{
    this.attach(id,socket,metrics);
    return this.serial(id,async()=>{
      for(const entry of await this.store.entries<any>('mapping-jobs'))if(entry.value.connectionId===id&&!entry.value.retained&&(force||(entry.value.nextAttemptAt??0)<=Date.now()))await this.applyMapping(entry.key,entry.value,metrics);
      const entries=(await this.store.entries<PendingMessage>('pending')).filter(entry=>entry.value.connectionId===id)
        .sort((a,b)=>(a.value.createdAt??'').localeCompare(b.value.createdAt??'')||(a.value.sequence??0)-(b.value.sequence??0));
      for(const {key,value:job}of entries)if(!job.retained&&(force||(job.nextAttemptAt??0)<=Date.now()))await this.process(key,job,socket,metrics,true);
      await this.applyRetainedReceipts(id,metrics,force);await this.refresh(id);await this.schedule(id);
    });
  }
  async wait(id:string){while(this.tails.has(id)||this.mappingTasks.get(id)?.size)await Promise.all([this.tails.get(id),...[...(this.mappingTasks.get(id)??[])]]);}
  private async failed(key:string,job:PendingMessage,error:unknown,metrics:ReceiveMetrics){
    const status=Number((error as any)?.status??(error as any)?.getStatus?.());
    const permanent=[400,401,403,404,409,413,415,422].includes(status)||[400,401,403,404,410,413,415,422].includes(Number(errorCode(error)));
    const retained=permanent||job.attempts>=this.policy.recoveryLimit,nextAttemptAt=Date.now()+Math.min(this.policy.recoveryBaseMs*2**Math.max(0,job.attempts-1),this.policy.recoveryMaxMs);
    await this.store.put('pending',key,{...job,retained,lastError:errorCode(error),nextAttemptAt,reason:permanent?'permanent_failure':retained?'retry_exhausted':'transient_failure'});
    metrics.error(retained?'recovery_retained':'recovery_retry_pending',error);
  }
  private async process(key:string,original:PendingMessage,socket:ProviderSocket,metrics:ReceiveMetrics,recovery=false):Promise<void>{
    const started=performance.now(),job={...original,attempts:original.attempts+1};this.active.set(job.connectionId,{type:job.type,started});
    try{
      if(original.attempts>=this.policy.recoveryLimit){
        const normalized=normalizeProviderMessage(job.connectionId,job.raw,job.type,job.epochAt,job.requestedHistory);
        const jid=normalized?await this.identities.resolve(job.connectionId,normalized.record.remoteJid):null;
        const conversation=jid?await this.database.getRepository(WhatsappConversation).findOneBy({connectionId:job.connectionId,remoteJid:jid}):null;
        const existing=conversation&&normalized?await this.database.getRepository(WhatsappMessage).findOneBy({conversationId:conversation.id,whatsappMessageId:normalized.record.whatsappMessageId,fromMe:normalized.record.fromMe}):null;
        let confirmed=!!existing&&!normalized?.metadata;
        if(existing&&normalized?.metadata)try{const file=await this.files.file(existing.conversationId,existing.id);await file.handle.close();confirmed=true;}catch{}
        if(confirmed){await this.store.remove('pending',key);metrics.event('recovery_persistence_confirmed');return;}
        await this.store.put('pending',key,{...original,retained:true,reason:'retry_exhausted'});metrics.event('recovery_exhausted');return;
      }
      await this.store.put('pending',key,job);
      if(recovery)metrics.event('recovery_attempt');
      const normalized=normalizeProviderMessage(job.connectionId,job.raw,job.type,job.epochAt,job.requestedHistory);
      if(!normalized){await this.store.put('pending',key,{...job,retained:true,reason:'filtered_identity_or_envelope'});metrics.event('message_retained_filtered');metrics.batch('message_retained',job.type==='notify'?'notify':'append',1,'retained','invalid_identity_or_envelope');return;}
      const {record}=normalized;metrics.event('message_observed',record.whatsappMessageId);
      if(normalized.unsupported){await this.store.put('pending',key,{...job,retained:true,reason:'unsupported'});metrics.event('message_retained_unsupported',record.whatsappMessageId);
        metrics.batch('message_retained',job.type==='notify'?'notify':'append',1,'retained','unsupported_content');
        if(Number.isInteger(job.raw.messageStubType))metrics.error('provider_message_stub',{code:job.raw.messageStubType});return;}
      metrics.event('message_processing',record.whatsappMessageId);metrics.event(normalized.classification==='recent'?'recent_candidate':'historical_or_unknown');
      if(normalized.senderAlternate&&normalized.sender&&normalized.sender!==normalized.senderAlternate)await this.identities.learn(job.connectionId,normalized.sender,normalized.senderAlternate);
      if(!normalized.alternate&&socket.resolveIdentity&&!record.remoteJid.endsWith('@g.us')){const alternate=await socket.resolveIdentity(record.remoteJid);if(alternate)normalized.alternate=alternate;}
      if(normalized.alternate&&normalized.alternate!==record.remoteJid&&!record.remoteJid.endsWith('@g.us'))record.remoteJid=await this.identities.learn(job.connectionId,record.remoteJid,normalized.alternate);
      else record.remoteJid=await this.identities.resolve(job.connectionId,record.remoteJid);
      metrics.event('sql_start',record.whatsappMessageId);
      const persisted=await this.messages.ingest(record).catch(error=>{metrics.error('sql_failed',error);throw error;});metrics.event('sql_ok',record.whatsappMessageId);
      metrics.event(persisted.duplicate?'message_duplicate':'message_persisted',record.whatsappMessageId,performance.now()-started);
      if(!persisted.duplicate&&normalized.classification==='recent')metrics.event('recent_message_persisted',record.whatsappMessageId);
      await this.store.put('message-metadata',persisted.message.id,{connectionId:job.connectionId,conversationId:persisted.message.conversationId,
        sender:normalized.sender,senderAlternate:normalized.senderAlternate,upsertType:job.type,classification:normalized.classification,originalTimestamp:record.messageTimestamp?.toISOString()??null});
      if(!persisted.duplicate)this.events.emit({type:'message.created',connectionId:job.connectionId,conversationId:persisted.message.conversationId,messageId:persisted.message.id});
      if(normalized.metadata){
        let available=false;try{const existing=await this.files.file(persisted.message.conversationId,persisted.message.id);await existing.handle.close();available=true;}catch{}
        if(!available){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(codedError('MEDIA_DOWNLOAD_TIMEOUT')),this.policy.mediaTimeoutMs);timer.unref();
          try{const metadata=this.filePolicy.metadata(normalized.metadata),source=await socket.download(job.raw,controller.signal),bytes=await collectMedia(source,this.filePolicy.limits[metadata.kind],controller.signal);
            await this.files.attach(persisted.message.conversationId,persisted.message.id,bytes,metadata);metrics.event('media_stored',record.whatsappMessageId);
            this.events.emit({type:'message.changed',connectionId:job.connectionId,conversationId:persisted.message.conversationId,messageId:persisted.message.id});
          }catch(error){metrics.error('media_download_failed',error);await this.files.recordUnavailable(persisted.message.conversationId,persisted.message.id,normalized.metadata);await this.failed(key,job,error,metrics);return;}
          finally{clearTimeout(timer);}
        }
      }
      await this.store.remove('pending',key);if(recovery)metrics.event('recovery_completed');
    }catch(error){metrics.error('message_processing_failed',error);await this.failed(key,job,error,metrics);}
    finally{this.active.delete(job.connectionId);}
  }
  async updates(id:string,updates:any[],metrics:ReceiveMetrics):Promise<void>{
    if(!Array.isArray(updates)||updates.length>this.policy.pendingLimit)throw codedError('RECEIPT_BATCH_LIMIT');const owned=cloneState(updates);
    return this.serial(id,async()=>{for(const event of owned){
      const status=({0:'failed',1:'pending',2:'sent',3:'delivered',4:'read',5:'read'} as const)[Number(event?.update?.status) as 0|1|2|3|4|5];
      const jid=normalizeJid(event?.key?.remoteJid);if(!status||!jid||typeof event.key.id!=='string'||typeof event.key.fromMe!=='boolean'){
        await this.store.put('event-review',id+'|'+reference(JSON.stringify(event,stateReplacer)),{connectionId:id,event,reason:'unsupported_message_update'});metrics.event('message_update_retained');continue;
      }
      const canonical=await this.identities.resolve(id,jid),receipt={connectionId:id,remoteJid:canonical,whatsappMessageId:event.key.id,fromMe:event.key.fromMe,status};
      const key=id+'|'+canonical+'|'+event.key.id+'|'+status;if(!await this.store.get('receipts',key))await this.store.put('receipts',key,receipt);
    }await this.applyRetainedReceipts(id,metrics);await this.refresh(id);await this.schedule(id);});
  }
  private async applyRetainedReceipts(id:string,metrics?:ReceiveMetrics,force=true){
    for(const entry of await this.store.entries<any>('receipts'))if(entry.value.connectionId===id){
      if(entry.value._retained||!force&&(entry.value._nextAttemptAt??0)>Date.now())continue;
      try{const receipt={...entry.value,remoteJid:await this.identities.resolve(id,entry.value.remoteJid)},result=await this.receipts.apply(receipt);
        if(result.matched){await this.store.remove('receipts',entry.key);if(result.changed)this.events.emit({type:'message.changed',connectionId:id,conversationId:result.conversationId,messageId:result.messageId});}
        else if(entry.value._attempts)await this.store.put('receipts',entry.key,{...entry.value,_waitingForMessage:true});
        metrics?.event('receipt_processed');
      }catch(error){metrics?.error('receipt_failed',error);const attempts=(entry.value._attempts??0)+1;
        await this.store.put('receipts',entry.key,{...entry.value,_waitingForMessage:false,_attempts:attempts,_retained:attempts>=this.policy.recoveryLimit||[400,409,422].includes(Number((error as any)?.status)),
          _nextAttemptAt:Date.now()+Math.min(this.policy.recoveryBaseMs*2**(attempts-1),this.policy.recoveryMaxMs),_errorCode:errorCode(error)});}
    }
  }
  async recoverReceipts(id:string){return this.serial(id,()=>this.applyRetainedReceipts(id));}
}
