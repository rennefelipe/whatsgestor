const {test}=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter,once}=require('node:events');
const {spawn}=require('node:child_process');
const {randomUUID}=require('node:crypto');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {ConfigService}=require('@nestjs/config');
require('@nestjs/common').Logger.overrideLogger(false);
const {ConnectionManager}=require('../dist/whatsapp-integration/connection-manager');
const {IntegrationLifecycle}=require('../dist/whatsapp-integration/whatsapp-integration.module');
const {IntegrationPolicy}=require('../dist/whatsapp-integration/integration-policy');
const {BaileysSocketFactory}=require('../dist/whatsapp-integration/baileys-socket.factory');
const {EncryptedStateStore}=require('../dist/whatsapp-integration/encrypted-state.store');
const {acquireSocketLease}=require('../dist/whatsapp-integration/socket-lease');
const {DomainEvents}=require('../dist/events/domain-events');
class MemoryStore {
  values=new Map();
  async get(ns,key){return this.values.get(ns+'|'+key)??null;}
  async put(ns,key,value){this.values.set(ns+'|'+key,value);}
}
const tick=()=>new Promise(r=>setImmediate(r));
async function until(check){for(let i=0;i<300;i++){if(await check())return;await new Promise(r=>setTimeout(r,10));}assert.fail('condition timed out');}
async function root(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'wg-autorestore-'));t.after(async()=>{assert.equal(path.dirname(dir),path.resolve(os.tmpdir()));assert.ok(path.basename(dir).startsWith('wg-autorestore-'));await fs.rm(dir,{recursive:true,force:true});});return dir;}
async function fixture(t,settings={}){
  const managers=[];
  t.after(async()=>{for(const m of managers)if(!m.destroyed)await m.onModuleDestroy();});
  const directory=await root(t),config=new ConfigService({WHATSAPP_INTEGRATION_STATE_DIR:directory,
    WHATSAPP_SESSIONS_DIR:path.join(directory,'legacy'),WHATSAPP_INTEGRATION_ENABLED:true,WHATSAPP_INTEGRATION_AUTO_RESTORE:true,
    WHATSAPP_RECONNECT_BASE_MS:20,WHATSAPP_RECONNECT_MAX_MS:80,...settings});
  const store=settings.memory?new MemoryStore():new EncryptedStateStore(config),policy=new IntegrationPolicy(config),rows=[],raws=[],options=[];
  const sdk={default:input=>{options.push(input);const raw={ev:new EventEmitter(),ws:Object.assign(new EventEmitter(),{isOpen:false}),end(){this.ws.isOpen=false;}};raws.push(raw);return raw;}};
  const factory=new BaileysSocketFactory(config,policy,store,async()=>sdk);
  const incoming={stats:()=>({}),suspend(){},async recover(){},async recoverReceipts(){},async wait(){}};
  const registry={async list(){return rows;},async find(id){return rows.find(row=>row.id===id);}};
  const manager=()=>{const m=new ConnectionManager(policy,registry,factory,store,incoming,new DomainEvents());managers.push(m);return m;};
  async function add(intent,active=true){const id=randomUUID();rows.push({id,isActive:active});await store.put('auth',id+'|creds',{me:{id:'fixture@s.whatsapp.net'},registered:false,proof:Buffer.from('preserve')});if(intent)await store.put('intent',id,intent);return id;}
  return {directory,config,store,policy,rows,raws,options,factory,manager,add};
}

test('application bootstrap restores valid authenticated sessions without operator click; shutdown and recreation preserve auth',async t=>{
  const f=await fixture(t),id=await f.add({restore:true}),before=await f.store.get('auth',id+'|creds');
  let registered=0;const first=f.manager();await new IntegrationLifecycle(first,{register(){registered++;}},{}).onApplicationBootstrap();
  assert.equal(registered,1);assert.equal(f.raws.length,1);assert.equal(first.status(id).state,'connecting');
  f.raws[0].ws.isOpen=true;f.raws[0].ev.emit('connection.update',{connection:'open'});await first.idle(id);
  assert.equal(first.status(id).state,'connected');await first.onModuleDestroy();
  const second=f.manager();await second.restore();assert.equal(f.raws.length,2);assert.equal(second.status(id).state,'connecting');
  assert.deepEqual(await f.store.get('auth',id+'|creds'),before);assert.equal(f.options[1].auth.creds.registered,false);
});

test('restore skips inactive, manual, revoked, and unauthenticated sessions; a legacy authenticated session is eligible',async t=>{
  const f=await fixture(t);await f.add({restore:true},false);await f.add({restore:false,manual:true});await f.add({restore:false,blocked:true,reason:'logged_out'});
  const unpaired=await f.add({restore:true});await f.store.put('auth',unpaired+'|creds',{registered:false});
  const legacy=await f.add(),m=f.manager();await m.restore();assert.equal(f.raws.length,1);assert.equal(m.status(legacy).state,'connecting');
  assert.equal(m.status(unpaired).requiresPairingRecovery,true);assert.equal(m.qr(unpaired).qrCodeDataUrl,null);
});

test('a damaged session does not prevent restoring the following session; global restore disable stays inert',async t=>{
  const f=await fixture(t),bad=await f.add({restore:true}),good=await f.add({restore:true}),get=f.store.get.bind(f.store);
  f.store.get=async(ns,key)=>{if(ns==='intent'&&key===bad)throw Object.assign(new Error('fixture'),{code:'STATE_READ_FAILED'});return get(ns,key);};
  const m=f.manager();await m.restore();assert.equal(m.status(bad).state,'error');assert.equal(m.status(good).state,'connecting');
  const disabled=await fixture(t,{WHATSAPP_INTEGRATION_AUTO_RESTORE:false});await disabled.add({restore:true});await disabled.manager().restore();assert.equal(disabled.raws.length,0);
});

test('concurrent restoration shares a single socket and manual disconnect remains stopped after manager recreation',async t=>{
  const f=await fixture(t),id=await f.add({restore:true}),m=f.manager();await Promise.all([m.restore(),m.restore()]);assert.equal(f.raws.length,1);
  await m.stop(id);await f.manager().restore();assert.equal(f.raws.length,1);assert.equal((await f.store.get('intent',id)).manual,true);
});

test('temporary close and a failed transport reopen consume a bounded progressive retry budget',async t=>{
  const f=await fixture(t,{WHATSAPP_RECONNECT_LIMIT:2,memory:true}),id=await f.add({restore:true}),m=f.manager();await m.restore();
  f.raws[0].ev.emit('connection.update',{connection:'close',lastDisconnect:{error:{output:{statusCode:408}}}});
  let failures=0;f.factory.open=async()=>{failures++;throw Object.assign(new Error('fixture'),{code:'ETIMEDOUT'});};
  await until(()=>m.status(id).authenticationIssue==='reconnect_budget_exhausted');assert.equal(failures,2);
  assert.equal(m.status(id).reconnectAttempts,2);assert.ok(await f.store.get('auth',id+'|creds'));
});

test('an unexpected provider QR during automatic login stops and requires operator intervention',async t=>{
  const f=await fixture(t,{memory:true}),id=await f.add({restore:true}),m=f.manager();
  await m.restore();f.factory.qrDataUrl=async()=>assert.fail('automatic restoration must not encode a QR');
  f.raws[0].ev.emit('connection.update',{qr:'simulated-provider-challenge'});await m.idle(id);
  assert.equal(m.status(id).state,'error');assert.equal(m.status(id).authenticationIssue,'pairing_incomplete');
  assert.equal(m.status(id).requiresPairingRecovery,true);assert.equal(m.qr(id).qrCodeDataUrl,null);
  assert.equal((await f.store.get('intent',id)).blocked,true);assert.ok(await f.store.get('auth',id+'|creds'));
});

test('Windows refuses active/reused PIDs, malformed ownership and foreign hosts without deleting metadata',{skip:process.platform!=='win32'},async t=>{
  const directory=await root(t);
  for(const record of [{pid:process.pid},{pid:process.pid,host:os.hostname(),processStartedAt:'1900-01-01'}, {pid:'unknown'}, {pid:2147483647,host:'foreign-host'}]){
    const id=randomUUID(),file=path.join(directory,id+'.socket.lock'),bytes=JSON.stringify(record);await fs.writeFile(file,bytes);
    await assert.rejects(()=>acquireSocketLease(directory,id),e=>['SOCKET_LEASE_EXISTS','SOCKET_LEASE_UNVERIFIED'].includes(e.code));assert.equal(await fs.readFile(file,'utf8'),bytes);
  }
});

test('Windows recovers proven dead legacy PID and serializes two competing instances',{skip:process.platform!=='win32'},async t=>{
  const directory=await root(t),id=randomUUID(),file=path.join(directory,id+'.socket.lock');
  const dead=spawn(process.execPath,['-e','process.exit(0)']);await once(dead,'exit');
  await fs.writeFile(file,JSON.stringify({pid:dead.pid}));
  const results=await Promise.allSettled([acquireSocketLease(directory,id),acquireSocketLease(directory,id)]);
  const winner=results.find(v=>v.status==='fulfilled');assert.equal(results.filter(v=>v.status==='fulfilled').length,1);
  assert.equal(results.find(v=>v.status==='rejected').reason.code,'SOCKET_LEASE_EXISTS');
  try{const owner=JSON.parse(await fs.readFile(file,'utf8'));assert.equal(owner.pid,process.pid);assert.ok(owner.token);assert.ok(owner.processStartedAt);}
  finally{await winner.value();}
  await assert.rejects(()=>fs.stat(file),{code:'ENOENT'});const again=await acquireSocketLease(directory,id);await again();
});

test('Windows kernel lease recovers after abrupt owner process termination',{skip:process.platform!=='win32'},async t=>{
  const directory=await root(t),id=randomUUID(),modulePath=require.resolve('../dist/whatsapp-integration/socket-lease');
  const child=spawn(process.execPath,['-e',`require(${JSON.stringify(modulePath)}).acquireSocketLease(process.argv[1],process.argv[2]).then(()=>{console.log('READY');setInterval(()=>{},1000)});`,directory,id],{stdio:['ignore','pipe','pipe'],windowsHide:true});
  t.after(()=>{if(child.exitCode===null)child.kill();});
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('owner startup timeout')),20000);child.stdout.on('data',data=>{if(data.toString().includes('READY')){clearTimeout(timer);resolve();}});child.once('error',reject);});
  await assert.rejects(()=>acquireSocketLease(directory,id),e=>e.code==='SOCKET_LEASE_EXISTS');
  const exited=once(child,'exit');child.kill();await exited;await tick();
  // EOF releases the helper's kernel handle asynchronously after its owner dies.
  let release;await until(async()=>{try{release=await acquireSocketLease(directory,id);return true;}catch(error){if(error.code!=='SOCKET_LEASE_EXISTS')throw error;return false;}});
  await release();
});
