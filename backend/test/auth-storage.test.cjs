const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {randomUUID,createHash}=require('node:crypto'),{EventEmitter}=require('node:events');
const {ConfigService}=require('@nestjs/config');
const {EncryptedStateStore}=require('../dist/whatsapp-integration/encrypted-state.store');
const {BaileysSocketFactory}=require('../dist/whatsapp-integration/baileys-socket.factory');
const {IntegrationPolicy}=require('../dist/whatsapp-integration/integration-policy');
const {PrivateFileStorage}=require('../dist/messages/private-file-storage');
const {storageDetails}=require('../dist/whatsapp-integration/storage-diagnostics');
async function fixture(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'wg-auth-storage-'));
 const config=new ConfigService({WHATSAPP_INTEGRATION_STATE_DIR:root,WHATSAPP_INTEGRATION_ENABLED:true,WHATSAPP_INTEGRATION_ALLOW_PAIRING:true});
 const store=new EncryptedStateStore(config),id=randomUUID();let options,ends=0;
 const raw={ev:new EventEmitter(),ws:{isOpen:true},end(){ends++;}};
 const sdk={initAuthCreds:()=>({counter:0}),default:input=>{options=input;return raw;}};
 const factory=new BaileysSocketFactory(config,new IntegrationPolicy(config),store,async()=>sdk);
 t.after(async()=>{assert.equal(path.dirname(root),path.resolve(os.tmpdir()));assert.match(path.basename(root),/^wg-auth-storage-/);await fs.rm(root,{recursive:true,force:true});});
 return {root,config,store,id,factory,raw,get options(){return options;},get ends(){return ends;}};
}
test('812 pre-keys persist with concurrent creds updates, tombstones and ordered reads; recreation retains all bytes',async t=>{
 const f=await fixture(t),socket=await f.factory.open(f.id,true),batch={'pre-key':{}};
 for(let i=0;i<812;i++)batch['pre-key'][String(i)]={private:Buffer.alloc(32,i%256),public:Buffer.alloc(32,(i+1)%256)};
 const keysWrite=f.options.auth.keys.set(batch);
 for(let counter=1;counter<=40;counter++)f.raw.ev.emit('creds.update',{counter});
 const read=f.options.auth.keys.get('pre-key',['0','811']);
 await keysWrite;assert.deepEqual((await read)['811'].private,Buffer.alloc(32,811%256));
 await f.options.auth.keys.set({'pre-key':{'0':null}});
 await Promise.all([socket.close(),socket.close()]);await f.factory.release(f.id);assert.equal(f.ends,1);
 const recreated=new EncryptedStateStore(f.config);assert.equal((await recreated.get('auth',f.id+'|creds')).counter,40);
 assert.equal((await recreated.get('auth',f.id+'|pre-key|0')).value,null);
 for(let i=1;i<812;i++)assert.deepEqual((await recreated.get('auth',f.id+'|pre-key|'+i)).value.private,batch['pre-key'][i].private);
 assert.equal(await recreated.get('auth-batches',f.id),null);
 assert.equal((await fs.readdir(f.root)).filter(n=>n.endsWith('.part')).length,0);
});
test('store snapshots at submission and serializes reads against replacement of the same file',async t=>{
 const f=await fixture(t);await f.store.put('auth','same',{counter:0});const jobs=[];
 for(let counter=1;counter<=60;counter++){
   const value={counter};jobs.push(f.store.put('auth','same',value));value.counter=-1;
   jobs.push(f.store.get('auth','same').then(v=>assert.equal(v.counter,counter)));
 }
 await Promise.all(jobs);assert.equal((await f.store.get('auth','same')).counter,60);
});
test('normal close captures credentials emitted by an in-flight task after end and drains them before returning',async t=>{
 const f=await fixture(t),socket=await f.factory.open(f.id,true);
 f.raw.end=()=>{queueMicrotask(()=>f.raw.ev.emit('creds.update',{counter:99}));};
 await socket.close();await f.factory.release(f.id);
 assert.equal((await new EncryptedStateStore(f.config).get('auth',f.id+'|creds')).counter,99);
 await assert.rejects(socket.saveCredentials({counter:100}),e=>e.code==='AUTH_SOCKET_CLOSED');
});
test('ACL timeout before publish preserves committed credentials and reports original cause without secrets',async t=>{
 const f=await fixture(t);await f.store.put('auth','same',{counter:1});
 const file=path.join(f.root,'auth--'+createHash('sha256').update('same').digest('hex')+'.enc'),before=await fs.readFile(file);
 const verify=f.store.directory.verifyRoot.bind(f.store.directory);let calls=0;
 f.store.directory.verifyRoot=async(...args)=>{if(++calls===2)throw Object.assign(new Error('SECRET PATH AND STDERR'),{code:'PRIVATE_ACL_CHECK_TIMEOUT',cause:{killed:true,signal:'SIGTERM'}});return verify(...args);};
 await assert.rejects(f.store.put('auth','same',{counter:2}),e=>{
  assert.equal(e.code,'STATE_WRITE_FAILED');const details=storageDetails(e);
  assert.deepEqual(details.causeCodes,['STATE_WRITE_FAILED','PRIVATE_ACL_CHECK_TIMEOUT']);assert.equal(details.phase,'verify_before_publish');assert.equal(details.processKilled,true);assert.doesNotMatch(JSON.stringify(details),/SECRET|STDERR/);return true;
 });
 assert.deepEqual(await fs.readFile(file),before);assert.equal((await new EncryptedStateStore(f.config).get('auth','same')).counter,1);
 assert.equal((await fs.readdir(f.root)).filter(n=>n.endsWith('.part')).length,1);
});
test('key-only failure emits once, prevents queued writes, drains once and retains replay journal',async t=>{
 const f=await fixture(t),socket=await f.factory.open(f.id,true),put=f.store.put.bind(f.store),events=[];let writes=0;
 socket.diagnostics.on('diagnostic',e=>events.push(e));
 f.store.put=async(ns,key,value)=>{writes++;if(ns==='auth'&&key.endsWith('|session|two'))throw Object.assign(new Error('SECRET'),{code:'EIO'});return put(ns,key,value);};
 const batch={session:{one:Buffer.from('one'),two:Buffer.from('two'),three:Buffer.from('three')}};
 const first=f.options.auth.keys.set(batch),queued=socket.saveCredentials({counter:5});
 await Promise.all([assert.rejects(first,/SECRET/),assert.rejects(queued)]);
 const count=writes;await assert.rejects(socket.saveCredentials({counter:6}));assert.equal(writes,count);assert.equal(events.length,1);
 assert.deepEqual(storageDetails(events[0]).causeCodes,['AUTH_STORAGE_FAILED','EIO']);
 const close1=socket.close(),close2=socket.close();assert.equal(close1,close2);await assert.rejects(close1);await f.factory.release(f.id);assert.equal(f.ends,1);
 assert.ok(await f.store.get('auth-batches',f.id));assert.equal((await f.store.get('auth',f.id+'|creds')).counter,0);
 f.store.put=put;const replacement=await f.factory.open(f.id,true);assert.equal(await f.store.get('auth-batches',f.id),null);
 assert.deepEqual((await f.options.auth.keys.get('session',['one','two','three'])),batch.session);
 await replacement.close();await f.factory.release(f.id);
});
test('Windows ACL checks coalesce, ignore child ctime churn, expire and still reject unsafe ACLs',{skip:process.platform!=='win32'},async t=>{
 const f=await fixture(t),directory=f.store.directory;let checks=0,release;
 directory.inspectWindowsAcl=async()=>{checks++;await new Promise(r=>release=r);};
 const pending=Array.from({length:15},()=>directory.verifyRoot());
 while(!release)await new Promise(r=>setTimeout(r,5));release();await Promise.all(pending);assert.equal(checks,1);
 await fs.writeFile(path.join(f.root,'synthetic-child'),Buffer.alloc(0));await directory.verifyRoot();assert.equal(checks,1);
 directory.checkedAcl.checkedAt=0;directory.inspectWindowsAcl=async()=>{checks++;throw Object.assign(new Error('unsafe fixture'),{code:'PRIVATE_ACL_UNSAFE'});};
 await assert.rejects(directory.verifyRoot(),e=>e.code==='PRIVATE_ACL_UNSAFE');assert.equal(checks,2);
});
test('Windows ACL timeout retries inspection, without treating denial as retryable',{skip:process.platform!=='win32'},async t=>{
 // Exercise the real retry method with an injected child-process boundary.
 const child=require('node:child_process'),original=child.execFile;let calls=0;
 child.execFile=(...args)=>{const callback=args.at(-1);calls++;queueMicrotask(()=>callback(calls===1?Object.assign(new Error('timeout'),{killed:true,signal:'SIGTERM'}):null,'',''));};
 t.after(()=>child.execFile=original);
 await PrivateFileStorage.prototype.inspectWindowsAcl.call({root:'synthetic'});assert.equal(calls,2);
 calls=0;child.execFile=(...args)=>{calls++;queueMicrotask(()=>args.at(-1)(Object.assign(new Error('denied'),{code:2}),'',''));};
 await assert.rejects(PrivateFileStorage.prototype.inspectWindowsAcl.call({root:'synthetic'}),e=>e.code==='PRIVATE_ACL_UNSAFE');assert.equal(calls,1);
});
