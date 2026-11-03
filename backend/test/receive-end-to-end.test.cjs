const {test}=require('node:test'),assert=require('node:assert/strict');
const {EventEmitter}=require('node:events'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {ConfigService}=require('@nestjs/config'),{Logger}=require('@nestjs/common');Logger.overrideLogger(false);
const {conversationsFixture,Conversation,Message}=require('./helpers/conversations-fixture.cjs');
const {IncomingPipeline:CurrentPipeline}=require('../dist/whatsapp-integration/incoming-pipeline');
const {ConnectionManager}=require('../dist/whatsapp-integration/connection-manager');
const {ReceiveMetrics,reference}=require('../dist/whatsapp-integration/receive-metrics');
const {IntegrationPolicy}=require('../dist/whatsapp-integration/integration-policy');
const {MessagesService,MessageReceiptsService}=require('../dist/messages/messages.service');
const {MessageFilesService}=require('../dist/messages/message-files.service');
const {FilePolicy}=require('../dist/messages/file-policy');
const {PrivateFileStorage}=require('../dist/messages/private-file-storage');
const {DomainEvents}=require('../dist/events/domain-events');
const {cloneState}=require('../dist/whatsapp-integration/state-codec');
function baseline(name){
 const {Module,createRequire}=require('node:module'),file=path.resolve(__dirname,'../../artifacts/receive-end-to-end/backup/backend/src/whatsapp-integration/'+name+'.ts');
 const m=new Module(file,module),r=createRequire(path.resolve(__dirname,'../dist/whatsapp-integration/'+name+'.js'));m.filename=file;
 m.require=id=>id==='./identity-resolver'?baseline('identity-resolver'):r(id);
 m._compile(require('typescript').transpileModule(require('node:fs').readFileSync(file,'utf8'),{compilerOptions:{module:1,target:9,experimentalDecorators:true,emitDecoratorMetadata:true,esModuleInterop:true}}).outputText,file);return m.exports;
}
const Pipeline=process.env.WG_RECEIVE_BASELINE==='1'?baseline('incoming-pipeline').IncomingPipeline:CurrentPipeline;
class MemoryStore{
 values=new Map();scans=0;writes=0;
 async get(ns,key){const v=this.values.get(ns+'|'+key);return v===undefined?null:cloneState(v);}
 async put(ns,key,value){this.writes++;this.values.set(ns+'|'+key,cloneState(value));}
 async remove(ns,key){this.values.delete(ns+'|'+key);}
 async entries(ns){if(ns==='identity-links')this.scans++;return [...this.values].filter(([key])=>key.startsWith(ns+'|')).map(([key,value])=>({key:key.slice(ns.length+1),value:cloneState(value)}));}
}
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const raw=(id,jid='123@lid',extra={})=>({key:{id,remoteJid:jid,fromMe:false},messageTimestamp:Math.floor(Date.now()/1000),message:{conversation:'PRIVATE_TEXT_FIXTURE'},...extra});
async function fixture(t,http=false){
 const f=await conversationsFixture(t,http,{STAGE6_INTEGRATION:true}),root=await fs.mkdtemp(path.join(os.tmpdir(),'wg-receive-e2e-'));
 const config=new ConfigService({WHATSAPP_INTEGRATION_ENABLED:true,WHATSAPP_MEDIA_DIR:root}),policy=new IntegrationPolicy(config),filePolicy=new FilePolicy(config);
 const files=new MessageFilesService(f.database,new PrivateFileStorage(filePolicy),filePolicy),messages=new MessagesService(f.records,files,filePolicy,f.conversations),receipts=new MessageReceiptsService(f.database);
 const store=new MemoryStore(),events=http?f.app.get(DomainEvents):new DomainEvents(),logs=[],observed=[];
 events.subscribe(event=>observed.push(event));const metrics=new ReceiveMetrics(e=>logs.push(e));
 const incoming=new Pipeline(store,messages,files,receipts,policy,filePolicy,f.database,events);
 const socket={events:new EventEmitter(),transport:new EventEmitter(),isOpen:()=>true,isBuffering:()=>false,async close(){},async saveCredentials(){},async download(){throw Error('unexpected media');}};
 const factory={async open(){return socket;},async release(){}},manager=new ConnectionManager(policy,{async find(){return {isActive:true};}},factory,store,incoming,events);
 manager.metrics=(id,generation)=>new ReceiveMetrics(e=>logs.push({...e,connectionRef:reference(id),generation}));
 t.after(async()=>{await manager.onModuleDestroy();incoming.onModuleDestroy();assert.equal(path.dirname(root),path.resolve(os.tmpdir()));assert.match(path.basename(root),/^wg-receive-e2e-/);await fs.rm(root,{recursive:true,force:true});});
 return {...f,root,store,events,observed,logs,metrics,incoming,socket,manager};
}
test('notify runs between history mappings instead of waiting for the entire mapping batch',async t=>{
 const f=await fixture(t),gate=deferred(),entered=deferred(),trace=[],learn=f.incoming.identities.learn.bind(f.incoming.identities);let calls=0;
 f.incoming.identities.learn=async(...args)=>{trace.push('mapping-'+(++calls));if(calls===1){entered.resolve();await gate.promise;}return learn(...args);};
 f.events.subscribe(e=>{if(e.type==='message.created')trace.push('persisted');});
 const bulk=f.incoming.mappings(f.connectionId,[{lid:'123@lid',pn:'999@s.whatsapp.net'},{lid:'456@lid',pn:'888@s.whatsapp.net'},{lid:'789@lid',pn:'777@s.whatsapp.net'}],f.metrics);
 await entered.promise;
 const received=f.incoming.accept(f.connectionId,{type:'notify',messages:[raw('during-history')]},f.socket,Date.now(),f.metrics);
 gate.resolve();await Promise.all([bulk,received]);
 assert.ok(trace.indexOf('persisted')<trace.indexOf('mapping-2'),JSON.stringify(trace));
 assert.equal(f.state.get(Message).length,1);
});
test('identity lookup scans durable evidence once and repeated mappings do not rewrite it',async t=>{
 const f=await fixture(t),pairs=Array.from({length:35},(_,i)=>({lid:(100+i)+'@lid',pn:(900+i)+'@s.whatsapp.net'}));
 await f.incoming.mappings(f.connectionId,pairs,f.metrics);const writes=f.store.writes;
 await f.incoming.mappings(f.connectionId,pairs,f.metrics);
 assert.ok(f.store.scans<=1,'full scans: '+f.store.scans);assert.equal(f.store.writes,writes);
 assert.equal(f.metrics.counters.identity_mapping_unchanged,35);
 await f.incoming.mappings(f.connectionId,[{lid:'800@lid',pn:'900@s.whatsapp.net'}],f.metrics);
 assert.equal((await f.store.entries('mapping-jobs'))[0].value.retained,true);
});
test('active upsert listener persists LID and PN messages once, lists latest messages with filters and emits SSE',async t=>{
 const f=await fixture(t,true),bearer=await f.token(f.admin),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
 t.after(()=>{clearTimeout(timer);controller.abort();});
 const response=await fetch((await f.app.getUrl())+'/whatsapp-events?connectionId='+f.connectionId,{headers:{Authorization:'Bearer '+bearer},signal:controller.signal});
 assert.equal(response.status,200);const reader=response.body.getReader();await reader.read();
 await f.manager.start(f.connectionId);assert.equal(f.socket.events.listenerCount('messages.upsert'),1);
 f.socket.events.emit('connection.update',{connection:'open'});await f.manager.idle(f.connectionId);
 const first=raw('original','123@lid',{key:{id:'original',remoteJid:'123@lid',remoteJidAlt:'999@s.whatsapp.net',fromMe:false}});
 f.socket.events.emit('messages.upsert',{type:'notify',messages:[first]});await f.manager.idle(f.connectionId);
 // Redelivery under the proven phone alias must reuse the same conversation.
 f.socket.events.emit('messages.upsert',{type:'notify',messages:[raw('original','999@s.whatsapp.net')]});
 f.socket.events.emit('messages.upsert',{type:'notify',messages:[raw('latest','999@s.whatsapp.net',{messageTimestamp:Math.floor(Date.now()/1000)+1,message:{conversation:'LATEST_FIXTURE'}})]});
 f.socket.events.emit('messages.upsert',{type:'append',messages:[raw('history','999@s.whatsapp.net',{messageTimestamp:1})]});
 await f.manager.idle(f.connectionId);
 const conversation=f.state.get(Conversation).find(c=>c.remoteJid==='123@lid');assert.ok(conversation);
 assert.equal(f.state.get(Message).filter(m=>m.conversationId===conversation.id).length,3);
 const list=await f.call('/whatsapp-conversations?connectionId='+f.connectionId+'&attendanceStatus=waiting&page=1&pageSize=50',{bearer});
 assert.equal(list.status,200);assert.equal(list.body.items.find(c=>c.id===conversation.id).lastMessage.textContent,'LATEST_FIXTURE');
 const finished=await f.call('/whatsapp-conversations?connectionId='+f.connectionId+'&attendanceStatus=finished&page=1&pageSize=50',{bearer});assert.equal(finished.body.total,0);
 const history=await f.call('/whatsapp-conversations/'+conversation.id+'/messages?page=1&pageSize=50',{bearer});assert.equal(history.body.total,3);
 assert.ok(f.queries.some(q=>q.sql.includes('SELECT TOP(1)')&&q.sql.includes('COALESCE')));
 let stream='';while(!stream.includes('message.created')){const chunk=await reader.read();assert.equal(chunk.done,false);stream+=Buffer.from(chunk.value).toString();}
 assert.match(stream,/message.created/);await reader.cancel();controller.abort();
 assert.equal(f.manager.status(f.connectionId).receivingObserved,true);
 assert.equal(f.logs.filter(e=>e.stage==='upsert_batch_received').length,4);
 assert.doesNotMatch(JSON.stringify(f.logs),/PRIVATE_TEXT_FIXTURE|LATEST_FIXTURE|@lid|@s\.whatsapp\.net/);
});
test('protocol envelopes and invalid identities stay retained with explicit safe reasons; own messages and history remain supported',async t=>{
 const f=await fixture(t),own=raw('own','111@s.whatsapp.net',{key:{id:'own',remoteJid:'111@s.whatsapp.net',fromMe:true}});
 await f.incoming.accept(f.connectionId,{type:'notify',messages:[own,raw('protocol','123@lid',{message:{protocolMessage:{type:0}}}),raw('invalid','invalid@server')]},f.socket,Date.now(),f.metrics);
 assert.equal(f.state.get(Message).length,1);assert.equal(f.state.get(Message)[0].fromMe,true);
 assert.deepEqual((await f.store.entries('pending')).map(e=>e.value.reason).sort(),['filtered_identity_or_envelope','unsupported']);
 assert.ok(f.logs.some(e=>e.reason==='unsupported_content'));assert.ok(f.logs.some(e=>e.reason==='invalid_identity_or_envelope'));
});
