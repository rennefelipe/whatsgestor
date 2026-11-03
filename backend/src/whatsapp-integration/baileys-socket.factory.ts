import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { pathToFileURL } from 'node:url';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { lstat, readFile } from 'node:fs/promises';
import { acquireSocketLease } from './socket-lease';
import { FilePolicy } from '../messages/file-policy';
import { PrivateFileStorage } from '../messages/private-file-storage';
import { IntegrationPolicy } from './integration-policy';
import { codedError,errorCode, WHATSAPP_STATE, type ProviderSocket, type SocketFactory, type StateStore } from './contracts';
import { cloneState, stateReviver } from './state-codec';
import { downloadVerifiedMedia } from './media-download';
import { normalizeJid } from './normalize-message';
import { storageError } from './storage-diagnostics';

export const SDK_LOADER=Symbol('SDK_LOADER');
export type SdkLoader=()=>Promise<any>;
export const APPROVED_BAILEYS_VERSION='7.0.0-rc14';
export function validateRc14Contract(sdk:any):void {
  for(const name of ['initAuthCreds','makeCacheableSignalKeyStore','generateMessageIDV2','getMediaKeys','jidDecode','jidNormalizedUser'])
    if(typeof sdk?.[name]!=='function')throw codedError('BAILEYS_CONTRACT_UNSUPPORTED');
  if(typeof (sdk.default??sdk.makeWASocket)!=='function'||typeof sdk.BufferJSON?.replacer!=='function'||typeof sdk.BufferJSON?.reviver!=='function'||
    typeof sdk.proto?.Message?.AppStateSyncKeyData?.create!=='function')throw codedError('BAILEYS_CONTRACT_UNSUPPORTED');
}
// Native import is retained under the application's CommonJS compiler. The
// specifier comes exclusively from require.resolve, never from an HTTP request.
const nativeImport=new Function('specifier','return import(specifier)') as (specifier:string)=>Promise<any>;
export const loadBaileys:SdkLoader=async()=>{
  try {
    const require=createRequire(__filename), entry=require.resolve('@whiskeysockets/baileys');
    let directory=dirname(entry), version:string|undefined;
    for(let depth=0;depth<4;depth++,directory=dirname(directory)) {
      try { const info=JSON.parse(await readFile(join(directory,'package.json'),'utf8'));
        if(info.name==='@whiskeysockets/baileys'){version=info.version;break;} } catch { /* parent package */ }
    }
    if(version!==APPROVED_BAILEYS_VERSION)throw codedError('BAILEYS_VERSION_NOT_APPROVED');
    const sdk=await nativeImport(pathToFileURL(entry).href);validateRc14Contract(sdk);return sdk;
  } catch(error) { if(['BAILEYS_VERSION_NOT_APPROVED','BAILEYS_CONTRACT_UNSUPPORTED'].includes((error as any)?.code))throw error;throw codedError('BAILEYS_DEPENDENCY_UNAVAILABLE'); }
};
/** The SDK return value alone confirms a transport write. Observe the server
 * ACK independently, registering before send so a fast ACK cannot be missed. */
export function sendWithRemoteAck(raw:any,jid:string,payload:Record<string,unknown>,messageId:string,signal:AbortSignal):Promise<any>{
  return new Promise((resolve,reject)=>{
    let sent:any,ack=false,done=false;
    const cleanup=()=>{raw.ws.off('CB:ack,class:message',onAck);raw.ev.off('connection.update',onConnection);signal.removeEventListener('abort',onAbort);};
    const fail=(error:unknown)=>{if(done)return;done=true;cleanup();reject(error);};
    const finish=()=>{if(!done&&sent&&ack){done=true;cleanup();resolve(sent);}};
    const onAck=(node:any)=>{if(node?.attrs?.id!==messageId)return;
      if(node.attrs.error){const error=codedError('PROVIDER_MESSAGE_REJECTED');Object.assign(error,{output:{statusCode:Number(node.attrs.error)}});fail(error);return;}
      ack=true;finish();};
    const onConnection=(update:any)=>{if(update.connection==='close')fail(update.lastDisconnect?.error??codedError('SOCKET_CLOSED_BEFORE_ACK'));};
    const onAbort=()=>fail(signal.reason??codedError('SEND_ABORTED'));
    raw.ws.on('CB:ack,class:message',onAck);raw.ev.on('connection.update',onConnection);signal.addEventListener('abort',onAbort,{once:true});
    if(signal.aborted){onAbort();return;}
    void Promise.resolve().then(()=>{signal.throwIfAborted();return raw.sendMessage(jid,payload,{messageId});}).then(value=>{sent=value;finish();},fail);
  });
}

/** No SDK loading, file access or socket creation occurs in the constructor. */
@Injectable()
export class BaileysSocketFactory implements SocketFactory {
  private readonly leases=new Map<string,()=>Promise<void>>();
  private readonly acquiring=new Set<string>();
  constructor(private readonly config:ConfigService,private readonly policy:IntegrationPolicy,
    @Inject(WHATSAPP_STATE)private readonly state:StateStore,@Inject(SDK_LOADER)private readonly load:SdkLoader){}
  private async lease(id:string) {
    if(this.leases.has(id)||this.acquiring.has(id))throw codedError('SOCKET_ALREADY_ACTIVE',409);
    this.acquiring.add(id);
    try {
    const root=this.config.get<string>('WHATSAPP_INTEGRATION_STATE_DIR')??join(homedir(),'.whatsgestor','integration-state');
    const directory=new PrivateFileStorage(new FilePolicy(new ConfigService({WHATSAPP_MEDIA_DIR:root})));
    await directory.verifyRoot(true);
    this.leases.set(id,await acquireSocketLease(root,id));
    } finally { this.acquiring.delete(id); }
  }
  async release(id:string){const release=this.leases.get(id);if(release){this.leases.delete(id);await release();}}
  async withSessionLock<T>(id:string,work:()=>Promise<T>):Promise<T>{
    await this.lease(id);try{return await work();}finally{await this.release(id);}
  }
  async hasAuthenticatedSession(id:string):Promise<boolean>{
    const selection=await this.state.get<{authId:string}>('session-auth',id);
    if(selection&&!/^[0-9a-f-]{36}$/i.test(selection.authId))throw codedError('SESSION_AUTH_INVALID');
    const creds=await this.state.get<any>('auth',(selection?.authId??id)+'|creds')??(selection?null:await this.legacy(id,'creds'));
    return typeof creds?.me?.id==='string'&&!!creds.me.id;
  }
  /** Existing legacy files are read only. All subsequent auth writes are sealed
   * in the new private store; no delete/overwrite is performed in that directory. */
  private async legacy(id:string,name:string):Promise<any|null> {
    const root=this.config.get<string>('WHATSAPP_SESSIONS_DIR')??join(homedir(),'.whatsgestor','whatsapp-sessions');
    if(!isAbsolute(root)||name.length>250||!/^[a-zA-Z0-9_@.()+=-]+$/.test(name))throw codedError('SESSION_PATH_INVALID');
    const path=join(root,id,name+'.json');
    try {
      let parent=dirname(path);
      for(;;){if((await lstat(parent)).isSymbolicLink())throw codedError('SESSION_PATH_INVALID');const next=dirname(parent);if(next===parent)break;parent=next;}
      const info=await lstat(path);
      if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1||info.size>1024*1024)throw codedError('SESSION_FILE_INVALID');
      return JSON.parse(await readFile(path,'utf8'),stateReviver);
    }catch(error){if((error as any)?.code==='ENOENT')return null;throw codedError('SESSION_READ_FAILED');}
  }
  async open(id:string,allowPairing:boolean):Promise<ProviderSocket> {
    if(!this.policy.enabled)throw codedError('WHATSAPP_INTEGRATION_DISABLED');
    if(!/^[0-9a-f-]{36}$/i.test(id))throw codedError('INVALID_CONNECTION_ID',400);
    await this.lease(id);
    try {
      const sdk=await this.load();
      const decodeAuth=(value:any)=>sdk.BufferJSON?JSON.parse(JSON.stringify(value,sdk.BufferJSON.replacer),sdk.BufferJSON.reviver):cloneState(value);
      const diagnostics=new EventEmitter();
      const technical=(value:any,message?:string)=>diagnostics.emit('diagnostic',{code:errorCode(value?.err??value?.error??value),
        category:typeof message==='string'&&message.includes("'init queries'")?'sync_initial_queries':'provider_error'});
      const quietLogger:any={level:'silent',trace(){},debug(){},info(){},warn(value:any){if(value?.err)technical(value);},error:technical,fatal:technical,child(){return this;}};
      const selection=await this.state.get<{authId:string}>('session-auth',id);
      if(selection&&!/^[0-9a-f-]{36}$/i.test(selection.authId))throw codedError('SESSION_AUTH_INVALID');
      const authId=selection?.authId??id;
      let creds=await this.state.get<any>('auth',authId+'|creds')??(selection?null:await this.legacy(id,'creds'));
      if(!creds){if(!allowPairing||!this.policy.allowPairing)throw codedError('EXISTING_SESSION_NOT_FOUND',409);creds=sdk.initAuthCreds();}
      // rc14 selects login using creds.me, and pair-success does not set registered.
      // Never invent registered=true or discard an identity based on this flag.
      if(!creds.me?.id&&!allowPairing)throw codedError('SESSION_PAIRING_REQUIRED',409);
      creds=decodeAuth(creds);
      await this.state.put('auth',authId+'|creds',creds);
      let writes=Promise.resolve();
      let storageFailure:Error|undefined,closing:Promise<void>|undefined,accepting=true;
      const failed=(cause:unknown,operation:string)=>{
        if(storageFailure)return;
        storageFailure=storageError('AUTH_STORAGE_FAILED',cause,{operation});
        diagnostics.emit('diagnostic',storageFailure);
      };
      const serialized=(work:()=>Promise<void>,operation:string)=>{
        if(!accepting)return Promise.reject(storageFailure??codedError('AUTH_SOCKET_CLOSED'));
        const next=writes.then(()=>{if(storageFailure)throw storageFailure;return work();});writes=next;
        // Observe all failures, including keys.set without a later creds.update.
        void next.catch(cause=>failed(cause,operation));return next;
      };
      const keys={
        get:async(type:string,ids:string[])=>{
          await writes;if(storageFailure)throw storageFailure;const result:Record<string,any>={};
          for(const key of ids){
            const stored=await this.state.get<any>('auth',authId+'|'+type+'|'+key);
            const value=stored?stored.value:selection?null:await this.legacy(id,(type+'-'+key).replace(/\//g,'__').replace(/:/g,'-'));
            const decoded=value==null?value:decodeAuth(value);
            result[key]=decoded&&type==='app-state-sync-key'?(sdk.proto.Message.AppStateSyncKeyData.fromObject??sdk.proto.Message.AppStateSyncKeyData.create)(decoded):decoded;
          }return result;
        },
        set:(input:Record<string,Record<string,any>>)=>{try{const data=cloneState(input);return serialized(async()=>{
          // A sealed write-ahead batch allows replay if interruption happens
          // between individual key files. A null value is a tombstone, not a
          // deletion of an old session file.
          await this.state.put('auth-batches',authId,data);
          for(const[type,values]of Object.entries(data))for(const[key,value]of Object.entries(values))await this.state.put('auth',authId+'|'+type+'|'+key,{value});
          await this.state.remove('auth-batches',authId);
        },'keys_set');}catch(cause){failed(cause,'keys_snapshot');return Promise.reject(cause);}},
      };
      const interrupted=await this.state.get<Record<string,Record<string,any>>>('auth-batches',authId);
      if(interrupted)await keys.set(interrupted);
      const raw=(sdk.default??sdk.makeWASocket)({auth:{creds,keys:sdk.makeCacheableSignalKeyStore? sdk.makeCacheableSignalKeyStore(keys,quietLogger):keys},logger:quietLogger,printQRInTerminal:false,emitOwnEvents:false});
      const saveCredentials=(update:Record<string,unknown>={})=>{
        if(storageFailure)return Promise.reject(storageFailure);
        if(!accepting)return Promise.reject(codedError('AUTH_SOCKET_CLOSED'));
        // Merge now, never inside the async queue: SDK mutates this same object.
        // Each write owns an immutable snapshot in event order.
        Object.assign(creds,cloneState(update));
        const snapshot=cloneState(creds);
        return serialized(()=>this.state.put('auth',authId+'|creds',snapshot),'creds_update');
      };
      const onCredentials=(update:Record<string,unknown>)=>{
        if(storageFailure||!accepting)return;
        try{void saveCredentials(update).catch(cause=>failed(cause,'creds_update'));}catch(cause){failed(cause,'creds_snapshot');}
      };
      raw.ev.on('creds.update',onCredentials);
      const lifetime=new AbortController();
      const stop=()=>{if(lifetime.signal.aborted)return;lifetime.abort(codedError('CONTROLLED_SOCKET_CLOSE'));raw.end(codedError('CONTROLLED_SOCKET_CLOSE'));};
      const abortable=async<T>(signal:AbortSignal,work:()=>Promise<T>):Promise<T>=>{
        if(signal.aborted)throw signal.reason;
        const abort=()=>stop();signal.addEventListener('abort',abort,{once:true});
        try{const value=await work();if(signal.aborted)throw signal.reason;return value;}finally{signal.removeEventListener('abort',abort);}
      };
      return {
        events:raw.ev,transport:raw.ws,diagnostics,isOpen:()=>raw.ws.isOpen===true,isBuffering:()=>typeof raw.ev.isBuffering==='function'?raw.ev.isBuffering():null,
        managesCredentials:true,authentication:()=>({hasIdentity:typeof creds.me?.id==='string'&&!!creds.me.id,registered:creds.registered===true}),
        authStorageFailure:()=>storageFailure,
        close:()=>closing??=(async()=>{
          try{stop();}finally{
            try{let pending;do{pending=writes;await pending;}while(pending!==writes);if(storageFailure)throw storageFailure;}
            catch(cause){throw storageFailure??storageError('AUTH_STORAGE_FAILED',cause,{operation:'close_drain'});}
            finally{accepting=false;raw.ev.off('creds.update',onCredentials);}
          }
        })(),saveCredentials,
        reserveMessageId:()=>sdk.generateMessageIDV2(creds.me?.id),
        send:(jid,payload,messageId,signal)=>abortable(signal,()=>sendWithRemoteAck(raw,jid,payload,messageId,signal)),
        download:(message,signal)=>downloadVerifiedMedia(message,AbortSignal.any([signal,lifetime.signal]),this.policy.mediaTimeoutMs,new FilePolicy(this.config),(key,kind)=>sdk.getMediaKeys(key,kind)),
        resolveIdentity:async(jid)=>{const normalized=normalizeJid(jid);if(!normalized)return null;
          const mapping=raw.signalRepository?.lidMapping;if(!mapping)return null;
          return normalizeJid(await (normalized.endsWith('@lid')||normalized.endsWith('@hosted.lid')?mapping.getPNForLID(normalized):mapping.getLIDForPN(normalized)));},
      };
    }catch(error){await this.release(id);throw error;}
  }
  async qrDataUrl(value:string):Promise<string>{
    try{const require=createRequire(__filename),sdk=await nativeImport(pathToFileURL(require.resolve('qrcode')).href);return await(sdk.default??sdk).toDataURL(value,{errorCorrectionLevel:'M',margin:2,width:320});}
    catch{throw codedError('QR_ENCODER_UNAVAILABLE');}
  }
}
