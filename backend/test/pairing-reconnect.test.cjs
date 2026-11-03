const {test}=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {randomUUID}=require('node:crypto');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {ConfigService}=require('@nestjs/config');
const {Logger}=require('@nestjs/common');
Logger.overrideLogger(false);
const {ConnectionManager}=require('../dist/whatsapp-integration/connection-manager');
const {BaileysSocketFactory}=require('../dist/whatsapp-integration/baileys-socket.factory');
const {IntegrationPolicy}=require('../dist/whatsapp-integration/integration-policy');
const {EncryptedStateStore}=require('../dist/whatsapp-integration/encrypted-state.store');
const {DomainEvents}=require('../dist/events/domain-events');
const {cloneState}=require('../dist/whatsapp-integration/state-codec');
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const tick=()=>new Promise(r=>setImmediate(r));
async function until(check){for(let i=0;i<200;i++){if(await check())return;await new Promise(r=>setTimeout(r,5));}assert.fail('condition did not settle');}
class MemoryStore{
  values=new Map();
  async get(ns,key){const v=this.values.get(ns+'|'+key);return v===undefined?null:cloneState(v);}
  async put(ns,key,v){this.values.set(ns+'|'+key,cloneState(v));}
  async remove(ns,key){this.values.delete(ns+'|'+key);}
  async entries(ns){return [...this.values].filter(([k])=>k.startsWith(ns+'|')).map(([k,value])=>({key:k.slice(ns.length+1),value:cloneState(value)}));}
}
async function fixture(t,{encrypted=false,...settings}={}){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'wg-pairing-'));
  const id=randomUUID(),other=randomUUID(),config=new ConfigService({WHATSAPP_INTEGRATION_ENABLED:true,WHATSAPP_INTEGRATION_ALLOW_PAIRING:true,
    WHATSAPP_RECONNECT_BASE_MS:1,WHATSAPP_RECONNECT_MAX_MS:1,WHATSAPP_INTEGRATION_STATE_DIR:root,WHATSAPP_SESSIONS_DIR:path.join(root,'unused-legacy'),...settings});
  const store=encrypted?new EncryptedStateStore(config):new MemoryStore(),policy=new IntegrationPolicy(config),raws=[],options=[];
  const sdk={initAuthCreds:()=>({registered:false,noiseKey:{private:Buffer.from('test-key')},counter:0}),default:input=>{
    options.push(input);const raw={ev:new EventEmitter(),ws:Object.assign(new EventEmitter(),{isOpen:false}),end(){this.ws.isOpen=false;}};
    // Simulates the SDK's synchronous mutation of its own auth object.
    raw.ev.on('creds.update',update=>Object.assign(input.auth.creds,update));raws.push(raw);return raw;
  }};
  const factory=new BaileysSocketFactory(config,policy,store,async()=>sdk);
  const incoming={stats:()=>({}),suspend(){},async recover(){},async recoverReceipts(){},async wait(){}};
  const events=new DomainEvents(),manager=new ConnectionManager(policy,{async find(key){assert.ok([id,other].includes(key));return {id:key,isActive:true};}},factory,store,incoming,events);
  t.after(async()=>{await manager.onModuleDestroy();assert.equal(path.dirname(root),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('wg-pairing-'));await fs.rm(root,{recursive:true,force:true});});
  return {root,id,other,config,policy,store,sdk,raws,options,factory,manager};
}
const close=(raw,code)=>raw.ev.emit('connection.update',{connection:'close',lastDisconnect:{error:{output:{statusCode:code},message:'SECRET-RAW-ERROR'}}});

test('factory persists every creds.update in order without rewinding mutable SDK credentials; close drains pending writes',async t=>{
  const f=await fixture(t),socket=await f.factory.open(f.id,true),gate=deferred(),put=f.store.put.bind(f.store),snapshots=[];
  f.store.put=async(ns,key,value)=>{if(ns==='auth'&&key.endsWith('|creds')){await gate.promise;snapshots.push(cloneState(value));}return put(ns,key,value);};
  f.raws[0].ev.emit('creds.update',{counter:1,me:{id:'123@s.whatsapp.net'}});
  f.raws[0].ev.emit('creds.update',{counter:2,account:{details:Buffer.from('pairing-proof')}});
  await tick();assert.equal(f.options[0].auth.creds.counter,2);
  let closed=false;const closing=socket.close().then(()=>closed=true);await tick();assert.equal(closed,false);
  gate.resolve();await closing;await f.factory.release(f.id);
  assert.deepEqual(snapshots.map(v=>v.counter),[1,2]);assert.equal(f.options[0].auth.creds.counter,2);
  assert.deepEqual((await f.store.get('auth',f.id+'|creds')).account.details,Buffer.from('pairing-proof'));
  assert.equal(f.raws[0].ev.listenerCount('creds.update'),1); // SDK listener only.
});

test('factory captures a credential event before the caller receives its socket',async t=>{
  const f=await fixture(t),original=f.sdk.default;
  f.sdk.default=input=>{const raw=original(input);queueMicrotask(()=>raw.ev.emit('creds.update',{counter:7,me:{id:'early@s.whatsapp.net'}}));return raw;};
  const socket=await f.factory.open(f.id,true);await socket.close();await f.factory.release(f.id);
  assert.equal((await f.store.get('auth',f.id+'|creds')).counter,7);
});

test('registered=false with a proven me identity resumes login without permission to pair; absent identity fails closed',async t=>{
  const f=await fixture(t);await f.store.put('auth',f.id+'|creds',{registered:false,me:{id:'123@s.whatsapp.net'}});
  const socket=await f.factory.open(f.id,false);assert.equal(socket.authentication().hasIdentity,true);assert.equal(socket.authentication().registered,false);
  await socket.close();await f.factory.release(f.id);
  await f.store.put('auth',f.id+'|creds',{registered:false});
  await assert.rejects(()=>f.factory.open(f.id,false),e=>e.code==='SESSION_PAIRING_REQUIRED');
});

test('515 waits for credentials, releases the old lease, preserves pairing permission and creates one replacement',async t=>{
  const f=await fixture(t);await f.manager.start(f.id,true);
  const gate=deferred(),put=f.store.put.bind(f.store);let pending=false;
  f.store.put=async(ns,key,value)=>{if(ns==='auth'&&value.me){pending=true;await gate.promise;}return put(ns,key,value);};
  const first=f.raws[0];first.ev.emit('creds.update',{me:{id:'123@s.whatsapp.net'},account:{details:Buffer.from('proof')}});
  first.ev.emit('connection.update',{isNewLogin:true,qr:undefined});close(first,515);close(first,515);
  await until(()=>pending);await tick();assert.equal(f.raws.length,1);gate.resolve();
  await until(()=>f.raws.length===2);await f.manager.idle(f.id);
  assert.equal(f.options[1].auth.creds.me.id,'123@s.whatsapp.net');assert.equal(f.options[1].auth.creds.registered,false);
  assert.equal(f.manager.status(f.id).restartAttempts,1);assert.equal(f.manager.status(f.id).reconnectAttempts,0);
  assert.equal(f.manager.runtime(f.id).allowPairing,true);
  f.raws[1].ev.emit('connection.update',{qr:'new-code'});f.factory.qrDataUrl=async()=> 'data:image/png;base64,dGVzdA==';
  await f.manager.idle(f.id);assert.equal(f.manager.status(f.id).status,'qr_ready');
});

test('repeated 515 is bounded and the restart budget survives manager recreation',async t=>{
  const f=await fixture(t,{WHATSAPP_RECONNECT_LIMIT:1});await f.manager.start(f.id,true);close(f.raws[0],515);
  await until(()=>f.raws.length===2);await f.manager.idle(f.id);
  await f.manager.stop(f.id,false);
  const replacement=new ConnectionManager(f.policy,{async find(){return {isActive:true};}},f.factory,f.store,{stats:()=>({}),suspend(){},async recover(){},async recoverReceipts(){},async wait(){}},new DomainEvents());
  t.after(()=>replacement.onModuleDestroy());await replacement.start(f.id,true);close(f.raws[2],515);await replacement.idle(f.id);
  assert.equal(f.raws.length,3);assert.equal((await f.store.get('intent',f.id)).reason,'reconnect_budget_exhausted');
});

test('a 515 during the initial recovery does not lose its replacement behind a pending start promise',async t=>{
  const f=await fixture(t),gate=deferred();let recovering=false;
  f.manager.incoming.recover=async()=>{if(!recovering){recovering=true;await gate.promise;}};
  const starting=f.manager.start(f.id,true);await until(()=>recovering);close(f.raws[0],515);
  await until(()=>f.manager.status(f.id).restartAttempts===1);await new Promise(r=>setTimeout(r,10));
  assert.equal(f.raws.length,1);gate.resolve();await starting;await until(()=>f.raws.length===2);await f.manager.idle(f.id);
});

test('401 is terminal, preserves auth and cannot be bypassed by disconnect or process recreation',async t=>{
  const f=await fixture(t);await f.store.put('auth',f.id+'|creds',{registered:false,me:{id:'123@s.whatsapp.net'}});
  await f.manager.start(f.id,true);close(f.raws[0],401);await f.manager.idle(f.id);
  assert.equal(f.manager.status(f.id).authenticationIssue,'credentials_rejected');
  await f.manager.stop(f.id);assert.equal((await f.store.get('intent',f.id)).blocked,true);
  await assert.rejects(()=>f.manager.start(f.id,true),e=>e.code==='SESSION_INTERVENTION_REQUIRED');
  assert.equal(f.raws.length,1);assert.equal((await f.store.get('auth',f.id+'|creds')).me.id,'123@s.whatsapp.net');
});

test('401 distinguishes an observed prior login from pairing without an identity; successful login resets budgets',async t=>{
  const f=await fixture(t);await f.manager.start(f.id,true);close(f.raws[0],401);await f.manager.idle(f.id);
  assert.equal(f.manager.status(f.id).authenticationIssue,'pairing_incomplete');
  await f.store.put('auth',f.other+'|creds',{registered:false,me:{id:'999@s.whatsapp.net'}});
  await f.store.put('reconnect-budget',f.other,{attempts:2,restarts:1});
  await f.manager.start(f.other,false);f.raws[1].ev.emit('connection.update',{connection:'open'});await f.manager.idle(f.other);
  assert.deepEqual(await f.store.get('reconnect-budget',f.other),{attempts:0,restarts:0});
  assert.equal(f.manager.runtime(f.other).allowPairing,false);close(f.raws[1],401);await f.manager.idle(f.other);
  assert.equal(f.manager.status(f.other).authenticationIssue,'logged_out');
});

test('credential storage failure blocks reconnect, releases the lease and logs no raw secrets',async t=>{
  const f=await fixture(t);await f.manager.start(f.id,true);const put=f.store.put.bind(f.store),logs=[];
  const original=Logger.prototype.log,originalError=console.error;Logger.prototype.log=function(value){logs.push(String(value));};console.error=(...args)=>logs.push(args.join(' '));
  t.after(()=>{Logger.prototype.log=original;console.error=originalError;});
  f.store.put=async(ns,key,value)=>{if(ns==='auth')throw Object.assign(new Error('SECRET-CREDENTIAL-FAILURE'),{code:'EIO'});return put(ns,key,value);};
  f.raws[0].ev.emit('creds.update',{secret:'SECRET-CREDENTIAL-PAYLOAD'});
  await until(async()=> (await f.store.get('intent',f.id))?.blocked);
  assert.equal(f.manager.status(f.id).authenticationIssue,'storage_failure');assert.equal(f.raws.length,1);
  assert.ok(logs.length>0);assert.doesNotMatch(logs.join('\n'),/SECRET-|stack|noiseKey/);
  assert.equal((await fs.readdir(f.root)).some(name=>name.endsWith('.lock')),false);
});

test('key-only storage failure stops the manager once and blocks restart without waiting for creds.update',async t=>{
  const f=await fixture(t);await f.manager.start(f.id,true);
  const put=f.store.put.bind(f.store);let closes=0;
  f.raws[0].end=()=>{closes++;};
  f.store.put=async(ns,key,value)=>{if(ns==='auth'&&key.includes('|session|'))throw Object.assign(new Error('PRIVATE-KEY-FAILURE'),{code:'ENOSPC'});return put(ns,key,value);};
  await assert.rejects(f.options[0].auth.keys.set({session:{one:Buffer.from('synthetic')}}));
  await until(async()=> (await f.store.get('intent',f.id))?.blocked);
  assert.equal(f.manager.status(f.id).authenticationIssue,'storage_failure');
  assert.equal(f.manager.status(f.id).counters.connection_critical_failure,1);assert.equal(closes,1);
  assert.ok(await f.store.get('auth-batches',f.id));assert.equal(f.raws.length,1);
  await assert.rejects(f.manager.start(f.id,true),e=>e.code==='SESSION_INTERVENTION_REQUIRED');
});

test('explicit storage retry replays existing keys with pairing forbidden and clears the block only after persistence succeeds',async t=>{
  const f=await fixture(t);await f.store.put('auth',f.id+'|creds',{me:{id:'existing@s.whatsapp.net'},counter:9});
  await f.store.put('auth-batches',f.id,{session:{one:Buffer.from('journal')}});
  await f.store.put('intent',f.id,{restore:false,blocked:true,reason:'storage_failure'});
  f.sdk.initAuthCreds=()=>assert.fail('must not initialize a new session');
  const make=f.sdk.default;f.sdk.default=input=>{assert.equal(f.store.values.get('intent|'+f.id).blocked,true);return make(input);};
  await f.manager.retryStorage(f.id);
  assert.equal(f.options[0].auth.creds.counter,9);assert.equal(f.manager.runtime(f.id).allowPairing,false);
  assert.equal(await f.store.get('auth-batches',f.id),null);
  assert.deepEqual((await f.store.get('auth',f.id+'|session|one')).value,Buffer.from('journal'));
  assert.equal((await f.store.get('intent',f.id)).blocked,undefined);assert.equal(await f.store.get('session-auth',f.id),null);
});

test('storage retry refuses other blocks and absent identity, preserving the blocked intent and existing auth',async t=>{
  const f=await fixture(t);
  await f.store.put('intent',f.id,{restore:false,blocked:true,reason:'credentials_rejected'});
  await assert.rejects(f.manager.retryStorage(f.id),e=>e.code==='STORAGE_RETRY_NOT_APPLICABLE');
  await f.store.put('intent',f.id,{restore:false,blocked:true,reason:'storage_failure'});
  await f.store.put('auth',f.id+'|creds',{counter:9});
  await assert.rejects(f.manager.retryStorage(f.id),e=>e.code==='SESSION_PAIRING_REQUIRED');
  assert.equal((await f.store.get('intent',f.id)).blocked,true);assert.equal(f.raws.length,0);
  assert.equal((await f.store.get('auth',f.id+'|creds')).counter,9);
});

test('a pending open transition cannot overwrite a concurrent fatal storage failure with connected',async t=>{
  const f=await fixture(t);await f.manager.start(f.id,true);const gate=deferred(),put=f.store.put.bind(f.store);let waiting=false;
  f.store.put=async(ns,key,value)=>{if(ns==='session-history'){waiting=true;await gate.promise;}return put(ns,key,value);};
  f.raws[0].ev.emit('connection.update',{connection:'open'});await until(()=>waiting);
  f.manager.runtime(f.id).socket.diagnostics.emit('diagnostic',Object.assign(new Error('synthetic'),{code:'AUTH_STORAGE_FAILED'}));
  await until(async()=> (await f.store.get('intent',f.id))?.blocked);gate.resolve();await f.manager.idle(f.id);
  assert.equal(f.manager.status(f.id).status,'error');assert.equal(f.manager.status(f.id).authenticationIssue,'storage_failure');
  assert.equal(f.manager.status(f.id).counters.connection_open,undefined);
});

test('prior SQL login is evidence for legacy auth, but is not attributed to a newly authorized auth namespace',async t=>{
  const f=await fixture(t);f.manager.registry.find=async id=>({id,isActive:true,lastConnectedAt:new Date()});
  await f.store.put('auth',f.id+'|creds',{registered:false,me:{id:'123@s.whatsapp.net'}});
  await f.manager.start(f.id,false);close(f.raws[0],401);await f.manager.idle(f.id);
  assert.equal(f.manager.status(f.id).authenticationIssue,'logged_out');
  await f.store.put('session-auth',f.other,{authId:randomUUID()});
  await f.manager.start(f.other,true);close(f.raws[1],401);await f.manager.idle(f.other);
  assert.equal(f.manager.status(f.other).authenticationIssue,'pairing_incomplete');
});

test('explicit recovery archives encrypted auth and switches only the chosen connection; old state is recoverable after recreation',async t=>{
  const f=await fixture(t,{encrypted:true}),old={registered:false,me:{id:'123@s.whatsapp.net'},secret:Buffer.from('PRIVATE-OLD')};
  await f.store.put('auth',f.id+'|creds',old);await f.store.put('auth',f.id+'|session|one',{value:Buffer.from('SIGNAL-OLD')});
  await f.store.put('auth',f.other+'|creds',{registered:true,me:{id:'999@s.whatsapp.net'}});
  await f.store.put('intent',f.id,{blocked:true,reason:'logged_out'});await f.store.put('intent',f.other,{blocked:true,reason:'session_error'});
  await assert.rejects(()=>f.manager.recoverPairing(f.id,f.other,true,'admin'),e=>e.code==='PAIRING_CONFIRMATION_REQUIRED');
  const result=await f.manager.recoverPairing(f.id,f.id,true,'admin'),reopened=new EncryptedStateStore(f.config);
  assert.equal((await reopened.get('pairing-archives',result.archiveId)).complete,true);
  assert.deepEqual(await reopened.get('pairing-auth',result.archiveId+'|'+f.id+'|creds'),old);
  assert.deepEqual(await reopened.get('auth',f.id+'|creds'),old);
  assert.deepEqual(await reopened.get('intent',f.other),{blocked:true,reason:'session_error'});
  assert.equal(await reopened.get('session-auth',f.other),null);
  assert.equal((await reopened.get('intent',f.id)).restore,false);assert.equal(f.raws.length,0);
  await f.manager.start(f.id,true);assert.equal(f.options[0].auth.creds.me,undefined);
  const master=await fs.readFile(path.join(f.root,'master.key'));assert.equal(master.length,32);
  for(const name of (await fs.readdir(f.root)).filter(n=>n.endsWith('.enc')))assert.equal((await fs.readFile(path.join(f.root,name))).includes(Buffer.from('PRIVATE-OLD')),false);
});

test('archive failure leaves the auth pointer and security block unchanged',async t=>{
  const f=await fixture(t);await f.store.put('auth',f.id+'|creds',{registered:false,me:{id:'old@s.whatsapp.net'}});
  await f.store.put('intent',f.id,{blocked:true,reason:'logged_out'});const put=f.store.put.bind(f.store);
  f.store.put=async(ns,key,value)=>{if(ns==='pairing-auth')throw new Error('archive disk full');return put(ns,key,value);};
  await assert.rejects(()=>f.manager.recoverPairing(f.id,f.id,true,'admin'),/archive disk full/);
  assert.equal(await f.store.get('session-auth',f.id),null);assert.equal((await f.store.get('intent',f.id)).blocked,true);
});

test('recovery interrupted after pointer publication stays blocked and forbids simultaneous starts',async t=>{
  const f=await fixture(t);await f.store.put('auth',f.id+'|creds',{registered:false,me:{id:'old@s.whatsapp.net'}});
  const gate=deferred(),put=f.store.put.bind(f.store);let copying=false;
  f.store.put=async(ns,key,value)=>{if(ns==='pairing-auth'){copying=true;await gate.promise;}if(ns==='reconnect-budget')throw new Error('storage outage');return put(ns,key,value);};
  const recovering=f.manager.recoverPairing(f.id,f.id,true,'admin');await until(()=>copying);
  await assert.rejects(()=>f.manager.start(f.id,true),e=>e.code==='PAIRING_RECOVERY_IN_PROGRESS');gate.resolve();
  await assert.rejects(()=>recovering,e=>e.code==='PAIRING_RECOVERY_STORAGE_FAILED');
  assert.equal((await f.store.get('intent',f.id)).blocked,true);
  await assert.rejects(()=>f.manager.start(f.id,true),e=>e.code==='SESSION_INTERVENTION_REQUIRED');
  assert.equal((await f.store.get('auth',f.id+'|creds')).me.id,'old@s.whatsapp.net');
});

test('pairing recovery HTTP requires JWT, an administrator and explicit confirmation; no SQL data is changed',async t=>{
  const {conversationsFixture}=require('./helpers/conversations-fixture.cjs');
  const f=await conversationsFixture(t,true,{STAGE6_INTEGRATION:true}),admin=await f.token(f.admin),regular=await f.token(f.regular),url=`/whatsapp-connections/${f.connectionId}/pairing-recovery`;
  const manager=f.app.get(ConnectionManager);let calls=0;manager.recoverPairing=async(id,confirmation,acknowledge,actorId)=>{calls++;return {id,confirmation,acknowledge,actorId};};
  const body={confirmation:f.connectionId,acknowledgeCredentialReplacement:true};
  assert.equal((await f.call(url,{method:'POST',body})).status,401);
  assert.equal((await f.call(url,{bearer:regular,method:'POST',body})).status,403);
  assert.equal((await f.call(url,{bearer:admin,method:'POST',body:{confirmation:f.connectionId}})).status,400);
  assert.equal((await f.call(url,{bearer:admin,method:'POST',body:{...body,acknowledgeCredentialReplacement:false}})).status,400);
  assert.equal(calls,0);const response=await f.call(url,{bearer:admin,method:'POST',body});assert.equal(response.status,201);assert.equal(calls,1);
  assert.equal(response.body.actorId,f.admin.id);assert.equal(f.writes.length,0);
  const retryUrl=`/whatsapp-connections/${f.connectionId}/storage-retry`;let retries=0;
  manager.retryStorage=async id=>{retries++;return {connectionId:id,status:'connecting'};};
  assert.equal((await f.call(retryUrl,{method:'POST'})).status,401);
  assert.equal((await f.call(retryUrl,{bearer:regular,method:'POST'})).status,403);assert.equal(retries,0);
  assert.equal((await f.call(retryUrl,{bearer:admin,method:'POST'})).status,201);assert.equal(retries,1);assert.equal(f.writes.length,0);
});
