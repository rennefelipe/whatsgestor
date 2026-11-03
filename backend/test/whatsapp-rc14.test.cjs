const {test}=require('node:test'),assert=require('node:assert/strict');
const {EventEmitter}=require('node:events'),http=require('node:http');
const fs=require('node:fs/promises'),path=require('node:path'),{tmpdir}=require('node:os');
const {randomUUID,randomBytes,createCipheriv,createHmac,createHash}=require('node:crypto');
const {ConfigService}=require('@nestjs/config'),{Logger}=require('@nestjs/common');Logger.overrideLogger(false);
const {conversationsFixture,Conversation,Message}=require('./helpers/conversations-fixture.cjs');
const {MessagesService,MessageReceiptsService}=require('../dist/messages/messages.service');
const {FilePolicy}=require('../dist/messages/file-policy');
const {PrivateFileStorage}=require('../dist/messages/private-file-storage');
const {MessageFilesService}=require('../dist/messages/message-files.service');
const {DomainEvents}=require('../dist/events/domain-events');
const {IntegrationPolicy}=require('../dist/whatsapp-integration/integration-policy');
const {IncomingPipeline}=require('../dist/whatsapp-integration/incoming-pipeline');
const {ConnectionManager}=require('../dist/whatsapp-integration/connection-manager');
const {EncryptedStateStore}=require('../dist/whatsapp-integration/encrypted-state.store');
const {ReceiveMetrics}=require('../dist/whatsapp-integration/receive-metrics');
const {downloadVerifiedMedia}=require('../dist/whatsapp-integration/media-download');
const {cloneState}=require('../dist/whatsapp-integration/state-codec');
const {normalizeProviderMessage,collectMedia}=require('../dist/whatsapp-integration/normalize-message');
const {APPROVED_BAILEYS_VERSION,validateRc14Contract,BaileysSocketFactory}=require('../dist/whatsapp-integration/baileys-socket.factory');
class MemoryStore{values=new Map();async get(ns,key){const value=this.values.get(ns+'|'+key);return value===undefined?null:cloneState(value);}async put(ns,key,value){this.values.set(ns+'|'+key,cloneState(value));}async remove(ns,key){this.values.delete(ns+'|'+key);}async entries(ns){return [...this.values].filter(([key])=>key.startsWith(ns+'|')).map(([key,value])=>({key:key.slice(ns.length+1),value:cloneState(value)}));}}
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function directory(t){const root=await fs.mkdtemp(path.join(tmpdir(),'wg-rc14-'));assert.equal(path.dirname(root),path.resolve(tmpdir()));assert.ok(path.basename(root).startsWith('wg-rc14-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));return root;}
const raw=(id,other={})=>({key:{id,remoteJid:'123@lid',fromMe:false},messageTimestamp:Math.floor(Date.now()/1000),message:{conversation:'private fixture'},...other});
function socket(){return {events:new EventEmitter(),transport:new EventEmitter(),opened:true,buffer:true,isOpen(){return this.opened;},isBuffering(){return this.buffer;},async close(){this.opened=false;},async saveCredentials(){},async download(){throw new Error('not expected');}};}
async function fixture(t,settings={}){
  const f=await conversationsFixture(t),root=await directory(t),config=new ConfigService({WHATSAPP_INTEGRATION_ENABLED:true,WHATSAPP_RECOVERY_BASE_MS:10,WHATSAPP_RECOVERY_MAX_MS:20,WHATSAPP_MEDIA_DIR:root,...settings});
  const policy=new IntegrationPolicy(config),filePolicy=new FilePolicy(config),storage=new PrivateFileStorage(filePolicy),files=new MessageFilesService(f.database,storage,filePolicy),messages=new MessagesService(f.records,files,filePolicy,f.conversations),receipts=new MessageReceiptsService(f.database),store=new MemoryStore(),events=new DomainEvents(),metrics=new ReceiveMetrics();
  const incoming=new IncomingPipeline(store,messages,files,receipts,policy,filePolicy,f.database,events);t.after(()=>incoming.onModuleDestroy());
  const sockets=[],factory={async open(){const value=socket();sockets.push(value);return value;},async release(){},async qrDataUrl(){throw new Error('QR not authorized');}},registry={async find(id){return{id,isActive:true};},async list(){return[{id:f.connectionId,isActive:true}];}};
  const manager=new ConnectionManager(policy,registry,factory,store,incoming,events);t.after(()=>manager.onModuleDestroy());
  return {...f,root,config,policy,filePolicy,files,messages,receipts,store,events,metrics,incoming,sockets,factory,registry,manager};
}
test('rc14 is the only approved target and a partial/incompatible SDK fails closed',()=>{
  assert.equal(APPROVED_BAILEYS_VERSION,'7.0.0-rc14');assert.throws(()=>validateRc14Contract({}),e=>e.code==='BAILEYS_CONTRACT_UNSUPPORTED');
});
test('new messages persist while history remains pending, without changing the SDK buffer',async t=>{
  const f=await fixture(t);await f.manager.start(f.connectionId);const value=f.sockets[0];value.events.emit('connection.update',{connection:'open'});
  value.events.emit('messages.upsert',{type:'notify',messages:[raw('live')]});await f.manager.idle(f.connectionId);
  assert.equal(f.state.get(Message).length,1);assert.equal(value.buffer,true);const health=f.manager.status(f.connectionId);
  assert.equal(health.syncComplete,false);assert.equal(health.receivingObserved,true);assert.equal(health.receiveHealth,'sync_pending');assert.ok(health.lastRecentPersistenceAt);
});
test('history status distinguishes explicit completion, inferred completion and paused phases',async t=>{
  const f=await fixture(t);await f.manager.start(f.connectionId);const value=f.sockets[0];
  value.events.emit('messaging-history.status',{syncType:0,status:'complete',explicit:false});assert.equal(f.manager.status(f.connectionId).historySync.state,'inferred_completion');
  value.events.emit('messaging-history.status',{syncType:0,status:'complete',explicit:true});assert.equal(f.manager.status(f.connectionId).historySync.state,'observed_phases_complete');
  value.events.emit('messaging-history.status',{syncType:2,status:'paused',explicit:false});assert.equal(f.manager.status(f.connectionId).historySync.state,'paused');
  assert.equal(f.manager.status(f.connectionId).syncComplete,false);
});
test('reachout restriction blocks sending only; receiving continues and explicit clearance restores send access',async t=>{
  const f=await fixture(t);await f.manager.start(f.connectionId);const value=f.sockets[0];value.events.emit('connection.update',{connection:'open',reachoutTimeLock:{isActive:true,enforcementType:'DEFAULT'}});
  await pause(5);assert.throws(()=>f.manager.readySocket(f.connectionId,true),e=>e.code==='WHATSAPP_COMMUNICATION_RESTRICTED');
  value.events.emit('messages.upsert',{type:'notify',messages:[raw('allowed-incoming')]});await f.manager.idle(f.connectionId);assert.equal(f.state.get(Message).length,1);
  value.events.emit('connection.update',{reachoutTimeLock:{isActive:false}});assert.equal(f.manager.readySocket(f.connectionId,true),value);
});
test('LID mapping events and history associations reuse existing conversations without inventing a phone',async t=>{
  const f=await fixture(t),conversation=f.seedConversation({remoteJid:'999@s.whatsapp.net'});await f.manager.start(f.connectionId);const value=f.sockets[0];
  value.events.emit('lid-mapping.update',{lid:'123@lid',pn:'999@s.whatsapp.net'});value.events.emit('messages.upsert',{type:'notify',messages:[raw('mapped')]});await f.manager.idle(f.connectionId);
  assert.equal(f.state.get(Message)[0].conversationId,conversation.id);
  await f.incoming.history(f.connectionId,{lidPnMappings:[{lid:'456@lid',pn:'888@s.whatsapp.net'}],messages:[raw('history',{key:{id:'history',remoteJid:'888@s.whatsapp.net',fromMe:false}})]},value,Date.now(),f.metrics);
  assert.equal(f.state.get(Conversation).filter(c=>c.remoteJid==='456@lid').length,1);
});
test('participantAlt is retained and proven sender identity supports a later individual message',async t=>{
  const f=await fixture(t),value=socket();await f.incoming.accept(f.connectionId,{type:'notify',messages:[raw('group',{key:{id:'group',remoteJid:'12-34@g.us',participant:'123:2@lid',participantAlt:'999:0@s.whatsapp.net',fromMe:false}})]},value,Date.now(),f.metrics);
  const group=f.state.get(Message)[0],metadata=await f.store.get('message-metadata',group.id);assert.equal(metadata.sender,'123@lid');assert.equal(metadata.senderAlternate,'999@s.whatsapp.net');
  await f.incoming.accept(f.connectionId,{type:'notify',messages:[raw('individual',{key:{id:'individual',remoteJid:'999@s.whatsapp.net',fromMe:false}})]},value,Date.now(),f.metrics);
  assert.equal(f.state.get(Conversation).filter(c=>c.remoteJid==='123@lid').length,1);
});
test('hosted identifiers retain their server, direction and chronology',()=>{
  const value=normalizeProviderMessage(randomUUID(),raw('hosted',{key:{id:'hosted',remoteJid:'123:2@hosted.lid',fromMe:false}}),'notify',Date.now(),false);
  assert.equal(value.record.remoteJid,'123@hosted.lid');assert.equal(value.classification,'recent');
});

test('explicit history completion is not downgraded by a delayed inferred or paused event',()=>{
  const metrics=new ReceiveMetrics();metrics.historyStatus({syncType:0,status:'complete',explicit:true});
  metrics.historyStatus({syncType:0,status:'paused',explicit:false});metrics.historyStatus({syncType:0,status:'complete',explicit:false});
  assert.equal(metrics.history['0'].explicit,true);assert.equal(metrics.history['0'].status,'complete');assert.equal(metrics.counters.history_status_stale_ignored,2);
});

test('overflow preserves every envelope for explicit review without a partial SQL import',async t=>{
  const f=await fixture(t,{WHATSAPP_PENDING_LIMIT:1});
  await assert.rejects(()=>f.incoming.accept(f.connectionId,{type:'notify',messages:[raw('one'),raw('two')]},socket(),Date.now(),f.metrics),e=>e.code==='RECEIVE_QUEUE_FULL');
  const retained=await f.store.entries('receive-overflow');assert.equal(retained.length,2);assert.equal(f.state.get(Message).length,0);
  assert.ok(retained.every(entry=>entry.value.retained&&entry.value.reason==='capacity_requires_review'));
});

test('a restarted exhausted journal confirms committed SQL without repeating its write',async t=>{
  const f=await fixture(t,{WHATSAPP_RECOVERY_LIMIT:1}),value=socket(),message=raw('committed');
  await f.incoming.accept(f.connectionId,{type:'notify',messages:[message]},value,Date.now(),f.metrics);
  await f.store.put('pending','interrupted',{connectionId:f.connectionId,type:'notify',epochAt:Date.now(),raw:message,requestedHistory:false,attempts:1});
  f.messages.ingest=async()=>{throw new Error('must not repeat committed SQL');};
  await f.incoming.recover(f.connectionId,value,f.metrics);assert.equal((await f.store.entries('pending')).length,0);assert.equal(f.state.get(Message).length,1);assert.equal(f.metrics.counters.recovery_persistence_confirmed,1);
});

test('mapping failure retries after recreation and conflicting identity evidence remains retained',async t=>{
  const f=await fixture(t),value=socket(),put=f.store.put.bind(f.store);let fail=true;
  f.store.put=async(ns,key,data)=>{if(ns==='identity-links'&&fail){fail=false;throw Object.assign(new Error('temporary storage fault'),{code:'EIO'});}return put(ns,key,data);};
  await f.incoming.mappings(f.connectionId,[{lid:'123@lid',pn:'999@s.whatsapp.net'}],f.metrics);
  assert.equal((await f.store.entries('mapping-jobs')).length,1);
  await f.incoming.recover(f.connectionId,value,f.metrics);assert.equal((await f.store.entries('mapping-jobs')).length,0);
  await f.incoming.mappings(f.connectionId,[{lid:'456@lid',pn:'999@s.whatsapp.net'}],f.metrics);
  assert.equal((await f.store.entries('mapping-jobs'))[0].value.retained,true);
});

test('receipt SQL failures retry without another incoming message and unmatched receipts do not spin',async t=>{
  const f=await fixture(t),value=socket(),key={id:'own-retry',remoteJid:'123@lid',fromMe:true};
  await f.incoming.accept(f.connectionId,{type:'notify',messages:[raw(key.id,{key})]},value,Date.now(),f.metrics);
  const apply=f.receipts.apply.bind(f.receipts);let attempts=0;
  f.receipts.apply=async input=>{if(++attempts===1)throw Object.assign(new Error('temporary SQL fault'),{code:'ECONNRESET'});return apply(input);};
  await f.incoming.updates(f.connectionId,[{key,update:{status:4}}],f.metrics);await pause(60);await f.incoming.wait(f.connectionId);
  assert.equal(attempts,2);assert.equal(f.state.get(Message)[0].status,'read');assert.equal((await f.store.entries('receipts')).length,0);
  attempts=0;await f.incoming.updates(f.connectionId,[{key:{...key,id:'not-yet-imported'},update:{status:4}}],f.metrics);
  await pause(60);await f.incoming.wait(f.connectionId);assert.equal(attempts,2);assert.equal(f.incoming.stats(f.connectionId).retryScheduled,false);
  assert.equal((await f.store.entries('receipts'))[0].value._waitingForMessage,true);
});
test('transient SQL failure retries automatically and deletes the journal only after persistence',async t=>{
  const f=await fixture(t),value=socket(),original=f.messages.ingest.bind(f.messages);let attempts=0;
  f.messages.ingest=async(...args)=>{if(++attempts===1)throw Object.assign(new Error('private SQL'),{driverError:{number:1205}});return original(...args);};
  await f.incoming.accept(f.connectionId,{type:'notify',messages:[raw('retry')]},value,Date.now(),f.metrics);assert.equal((await f.store.entries('pending')).length,1);
  await pause(50);await f.incoming.wait(f.connectionId);assert.equal(attempts,2);assert.equal(f.state.get(Message).length,1);assert.equal((await f.store.entries('pending')).length,0);assert.equal(f.metrics.counters.recovery_completed,1);
});
test('permanent errors and exhausted retries remain recoverable evidence without infinite loops',async t=>{
  const f=await fixture(t,{WHATSAPP_RECOVERY_LIMIT:2}),value=socket();let attempts=0;
  f.messages.ingest=async()=>{attempts++;throw Object.assign(new Error('SQL down'),{code:'ECONNRESET'});};
  await f.incoming.accept(f.connectionId,{type:'notify',messages:[raw('failed')]},value,Date.now(),f.metrics);await pause(70);await f.incoming.wait(f.connectionId);
  const entry=(await f.store.entries('pending'))[0];assert.equal(entry.value.attempts,2);assert.equal(entry.value.retained,true);assert.equal(entry.value.reason,'retry_exhausted');assert.equal(attempts,2);
  assert.equal(f.incoming.stats(f.connectionId).recoveryState,'review_required');
});
test('invalid identities are retained rather than silently removed',async t=>{
  const f=await fixture(t);await f.incoming.accept(f.connectionId,{type:'notify',messages:[raw('unknown',{key:{id:'unknown',remoteJid:'unknown@other',fromMe:false}})]},socket(),Date.now(),f.metrics);
  assert.equal(f.state.get(Message).length,0);assert.equal((await f.store.entries('pending'))[0].value.reason,'filtered_identity_or_envelope');
});
test('older metadata cannot overwrite a more recent contact name or last-message timestamp',async t=>{
  const f=await fixture(t),value=socket();await f.incoming.accept(f.connectionId,{type:'notify',messages:[raw('new',{pushName:'latest'})]},value,Date.now(),f.metrics);
  await f.incoming.accept(f.connectionId,{type:'append',messages:[raw('old',{pushName:'old',messageTimestamp:1})]},value,Date.now(),f.metrics);
  const conversation=f.state.get(Conversation).find(c=>c.remoteJid==='123@lid');assert.equal(conversation.contactName,'latest');assert.ok(conversation.lastMessageAt.getTime()>1000);
});
test('receipt already retained is applied immediately when its message is persisted',async t=>{
  const f=await fixture(t),key={id:'own',remoteJid:'123@lid',fromMe:true};await f.incoming.updates(f.connectionId,[{key,update:{status:4}}],f.metrics);
  await f.incoming.accept(f.connectionId,{type:'notify',messages:[raw('own',{key})]},socket(),Date.now(),f.metrics);assert.equal(f.state.get(Message)[0].status,'read');assert.equal((await f.store.entries('receipts')).length,0);
});
test('reconnect budget persists across process recreation and stops at the configured limit',async t=>{
  const f=await fixture(t,{WHATSAPP_RECONNECT_LIMIT:1,WHATSAPP_RECONNECT_BASE_MS:5});await f.manager.start(f.connectionId);f.sockets[0].events.emit('connection.update',{connection:'close',lastDisconnect:{error:{output:{statusCode:408}}}});
  await pause(30);assert.equal(f.sockets.length,2);assert.equal((await f.store.get('reconnect-budget',f.connectionId)).attempts,1);
  await f.manager.stop(f.connectionId,false);const replacement=new ConnectionManager(f.policy,f.registry,f.factory,f.store,f.incoming,f.events);t.after(()=>replacement.onModuleDestroy());
  await replacement.start(f.connectionId);f.sockets[2].events.emit('connection.update',{connection:'close',lastDisconnect:{error:{output:{statusCode:408}}}});await pause(30);
  assert.equal((await f.store.get('intent',f.connectionId)).reason,'reconnect_budget_exhausted');assert.equal(f.sockets.length,3);
});
test('buffer serialization preserves bytes, bigint and numeric-keyed metadata without coercion',()=>{
  const value={bytes:new Uint8Array([0,255,7]),buffer:Buffer.from('test'),counter:12n,metadata:{'0':14,'1':15}};const copy=cloneState(value);
  assert.deepEqual(copy.bytes,Buffer.from([0,255,7]));assert.deepEqual(copy.buffer,value.buffer);assert.equal(copy.counter,12n);assert.deepEqual(copy.metadata,value.metadata);
});
test('encrypted auth categories survive recreation; corruption cannot be overwritten or moved across namespaces',async t=>{
  const root=await directory(t),config=new ConfigService({WHATSAPP_INTEGRATION_STATE_DIR:root}),store=new EncryptedStateStore(config),id=randomUUID();
  for(const [category,value]of Object.entries({'lid-mapping':'123@lid','device-list':['1','2'],tctoken:{token:Buffer.from('private'),senderTimestamp:3}}))await store.put('auth',id+'|'+category,{value});
  const recovered=new EncryptedStateStore(config);assert.deepEqual((await recovered.get('auth',id+'|tctoken')).value.token,Buffer.from('private'));
  await store.put('pending','same-key',{private:'preserved'});const file=(await fs.readdir(root)).find(name=>name.startsWith('pending--')),original=await fs.readFile(path.join(root,file));
  await fs.writeFile(path.join(root,file),Buffer.from('damaged fixture'));await assert.rejects(()=>recovered.put('pending','same-key',{replacement:true}),/STATE_READ_FAILED/);assert.equal((await fs.readFile(path.join(root,file))).toString(),'damaged fixture');
  await fs.writeFile(path.join(root,file.replace('pending--','auth--')),original);await assert.rejects(()=>recovered.get('auth','same-key'),/STATE_READ_FAILED/);
});

test('an interrupted auth key batch replays before provider construction and partial credentials are merged',async t=>{
  const root=await directory(t),id=randomUUID(),store=new MemoryStore(),config=new ConfigService({WHATSAPP_INTEGRATION_ENABLED:true,WHATSAPP_INTEGRATION_STATE_DIR:root,WHATSAPP_SESSIONS_DIR:path.join(root,'unused-legacy')});
  await store.put('auth',id+'|creds',{registered:true,me:{id:'123@s.whatsapp.net'},old:Buffer.from('retained')});let options;
  const sdk={default:input=>{options=input;return{ev:new EventEmitter(),ws:Object.assign(new EventEmitter(),{isOpen:true}),end(){}};}};
  const first=new BaileysSocketFactory(config,new IntegrationPolicy(config),store,async()=>sdk),value=await first.open(id,false);
  await value.saveCredentials({counter:2});assert.equal((await store.get('auth',id+'|creds')).registered,true);
  const put=store.put.bind(store);let fail=true;store.put=async(ns,key,data)=>{if(fail&&ns==='auth'&&key.endsWith('|device-list|other')){fail=false;throw new Error('simulated interruption');}return put(ns,key,data);};
  await assert.rejects(()=>options.auth.keys.set({'tctoken':{one:{token:Buffer.from([0,255])}},'device-list':{other:['1','2']}}),/interruption/);
  assert.ok(await store.get('auth-batches',id));await value.close().catch(()=>{});await first.release(id);
  const replacement=new BaileysSocketFactory(config,new IntegrationPolicy(config),store,async()=>sdk),restored=await replacement.open(id,false);
  assert.equal(await store.get('auth-batches',id),null);assert.deepEqual((await options.auth.keys.get('tctoken',['one'])).one.token,Buffer.from([0,255]));
  assert.deepEqual((await options.auth.keys.get('device-list',['other'])).other,['1','2']);assert.equal(options.auth.creds.counter,2);assert.deepEqual(options.auth.creds.old,Buffer.from('retained'));
  await restored.close();await replacement.release(id);
});

test('version-one encrypted records remain readable and an interrupted part never replaces committed state',async t=>{
  const root=await directory(t),config=new ConfigService({WHATSAPP_INTEGRATION_STATE_DIR:root}),store=new EncryptedStateStore(config);
  await store.put('auth','seed',{registered:true});const master=await fs.readFile(path.join(root,'master.key')),iv=randomBytes(12),encrypt=createCipheriv('aes-256-gcm',master,iv);
  const body=Buffer.concat([encrypt.update(Buffer.from(JSON.stringify({key:'old',value:{registered:true,bytes:{type:'Buffer',data:[0,255]}}}))),encrypt.final()]);
  const name='auth--'+createHash('sha256').update('old').digest('hex')+'.enc';await fs.writeFile(path.join(root,name),Buffer.concat([Buffer.from([1]),iv,encrypt.getAuthTag(),body]));
  await fs.writeFile(path.join(root,name+'.interrupted.part'),Buffer.from('partial unpublished fixture'));
  const recovered=new EncryptedStateStore(config);assert.deepEqual((await recovered.get('auth','old')).bytes,Buffer.from([0,255]));assert.equal((await recovered.entries('auth')).length,2);
});
const png=Buffer.from([137,80,78,71,13,10,26,10,0,1,2,3]);
function mediaFixture(content=png,kind='image'){
  const keys={iv:randomBytes(16),cipherKey:randomBytes(32),macKey:randomBytes(32)},cipher=createCipheriv('aes-256-cbc',keys.cipherKey,keys.iv),encrypted=Buffer.concat([cipher.update(content),cipher.final()]);
  const mac=createHmac('sha256',keys.macKey).update(keys.iv).update(encrypted).digest().subarray(0,10),body=Buffer.concat([encrypted,mac]);
  const formats={image:['imageMessage','image/png','mock.png'],audio:['audioMessage','audio/ogg','mock.ogg'],video:['videoMessage','video/mp4','mock.mp4'],document:['documentMessage','application/pdf','mock.pdf']},[field,mimetype,fileName]=formats[kind];
  const file={mediaKey:randomBytes(32),fileSha256:createHash('sha256').update(content).digest(),fileEncSha256:createHash('sha256').update(body).digest(),fileLength:content.length,mimetype,fileName,directPath:'/encrypted-fixture'};
  return {keys,body,file,message:raw('media',{message:{[field]:file}}),derive:async()=>keys};
}
async function fetchServer(t,handler){const server=http.createServer(handler);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});return 'http://127.0.0.1:'+server.address().port;}
test('media HTTP timeout actually cancels a request before response headers arrive',async t=>{
  const m=mediaFixture(),policy=new FilePolicy(new ConfigService({}));let started=false,closed=false;
  const url=await fetchServer(t,(req,res)=>{if(req.method==='HEAD'){res.end();return;}started=true;res.on('close',()=>closed=true);});
  // Initialize Node's HTTP dispatcher before testing cancellation of an active
  // request. Cold fetch startup can exceed the old 80ms under Windows load.
  await fetch(url,{method:'HEAD'});
  await assert.rejects(()=>downloadVerifiedMedia(m.message,new AbortController().signal,500,policy,m.derive,(_u,options)=>fetch(url,options)),e=>e.code==='MEDIA_DOWNLOAD_TIMEOUT');
  for(let i=0;i<100&&!closed;i++)await pause(10);
  assert.equal(started,true);assert.equal(closed,true);
});
test('media external cancellation interrupts an active response body',async t=>{
  const m=mediaFixture(),policy=new FilePolicy(new ConfigService({})),controller=new AbortController();let closed=false;
  const url=await fetchServer(t,(_req,res)=>{res.writeHead(200);res.write(m.body.subarray(0,8));res.on('close',()=>closed=true);setTimeout(()=>controller.abort(new Error('operator cancellation')),20);});
  await assert.rejects(()=>downloadVerifiedMedia(m.message,controller.signal,500,policy,m.derive,(_u,options)=>fetch(url,options)),/operator cancellation/);await pause(20);assert.equal(closed,true);
});
test('verified image/audio/video/PDF downloads expose only authenticated plaintext',async()=>{
  const samples=[[png,'image'],[Buffer.from('OggSfixture'),'audio'],[Buffer.concat([Buffer.from([0,0,0,24]),Buffer.from('ftypisom0000')]),'video'],[Buffer.from('%PDF-1.7\nfixture\n%%EOF'),'document']],policy=new FilePolicy(new ConfigService({}));
  for(const [content,kind]of samples){const m=mediaFixture(content,kind),signal=new AbortController().signal,stream=await downloadVerifiedMedia(m.message,signal,1000,policy,m.derive,async(_u,options)=>{assert.equal(options.redirect,'error');assert.ok(options.signal);return new Response(m.body);});assert.deepEqual(await collectMedia(stream,20*1024*1024,signal),content);}
});
test('media integrity, MIME, declared size and unsafe URLs fail without storing bytes',async()=>{
  const policy=new FilePolicy(new ConfigService({}));
  for(const [mutate,code]of [[m=>m.body[0]^=1,'MEDIA_ENCRYPTED_HASH_MISMATCH'],[m=>{m.file.fileEncSha256=null;m.body[m.body.length-1]^=1;},'MEDIA_MAC_MISMATCH'],[m=>m.file.fileSha256=Buffer.alloc(32),'MEDIA_PLAINTEXT_HASH_MISMATCH'],[m=>m.file.fileLength=99,'MEDIA_LENGTH_MISMATCH']]){
    const m=mediaFixture();mutate(m);await assert.rejects(()=>downloadVerifiedMedia(m.message,new AbortController().signal,1000,policy,m.derive,async()=>new Response(m.body)),e=>e.code===code);
  }
  const spoof=mediaFixture(Buffer.from('<html>not PNG</html>'));await assert.rejects(()=>downloadVerifiedMedia(spoof.message,new AbortController().signal,1000,policy,spoof.derive,async()=>new Response(spoof.body)),e=>e.getStatus()===415);
  const unsafe=mediaFixture();unsafe.file.url='http://127.0.0.1/private';let requested=false;
  await assert.rejects(()=>downloadVerifiedMedia(unsafe.message,new AbortController().signal,1000,policy,unsafe.derive,async()=>{requested=true;return new Response();}),e=>e.code==='MEDIA_URL_NOT_ALLOWED');assert.equal(requested,false);
  const oversized=mediaFixture();await assert.rejects(()=>downloadVerifiedMedia(oversized.message,new AbortController().signal,1000,policy,oversized.derive,async()=>new Response(oversized.body,{headers:{'content-length':'999999999'}})),e=>e.code==='MEDIA_SIZE_LIMIT');
});
