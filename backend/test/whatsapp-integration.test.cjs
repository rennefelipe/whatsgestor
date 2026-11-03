const {test}=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {randomUUID}=require('node:crypto');
const fs=require('node:fs/promises'),path=require('node:path'),{tmpdir}=require('node:os');
const {ConfigService}=require('@nestjs/config');
const {Logger}=require('@nestjs/common');Logger.overrideLogger(false);
const {conversationsFixture,Conversation,Message,Media,User}=require('./helpers/conversations-fixture.cjs');
const {MessagesService,MessageReceiptsService}=require('../dist/messages/messages.service');
const {MessageFilesService}=require('../dist/messages/message-files.service');
const {PrivateFileStorage}=require('../dist/messages/private-file-storage');
const {FilePolicy}=require('../dist/messages/file-policy');
const {DomainEvents}=require('../dist/events/domain-events');
const {IntegrationPolicy}=require('../dist/whatsapp-integration/integration-policy');
const {IncomingPipeline}=require('../dist/whatsapp-integration/incoming-pipeline');
const {ConnectionManager}=require('../dist/whatsapp-integration/connection-manager');
const {EncryptedStateStore}=require('../dist/whatsapp-integration/encrypted-state.store');
const {BaileysSocketFactory,sendWithRemoteAck}=require('../dist/whatsapp-integration/baileys-socket.factory');
const {BaileysOutboundAdapter}=require('../dist/whatsapp-integration/outbound-adapter');
const {ReceiveMetrics}=require('../dist/whatsapp-integration/receive-metrics');
const {normalizeProviderMessage}=require('../dist/whatsapp-integration/normalize-message');
const {RealtimeAccess}=require('../dist/whatsapp-integration/realtime.controller');
const copy=value=>JSON.parse(JSON.stringify(value),(_k,v)=>v?.type==='Buffer'?Buffer.from(v.data):v);
class MemoryStore {
  values=new Map();
  async get(ns,key){return this.values.has(ns+'|'+key)?copy(this.values.get(ns+'|'+key)):null;}
  async put(ns,key,value){this.values.set(ns+'|'+key,copy(value));}
  async remove(ns,key){this.values.delete(ns+'|'+key);}
  async entries(ns){return [...this.values].filter(([key])=>key.startsWith(ns+'|')).map(([key,value])=>({key:key.slice(ns.length+1),value:copy(value)}));}
}
const png=Buffer.from([137,80,78,71,13,10,26,10,0,1,2,3]);
const raw=(id,values={})=>({key:{id,remoteJid:'12345@lid',fromMe:false},messageTimestamp:Math.floor(Date.now()/1000),message:{conversation:'mock private content'},...values});
const tick=()=>new Promise(resolve=>setTimeout(resolve,5));
async function directory(t){const root=await fs.mkdtemp(path.join(tmpdir(),'wg-stage6-'));assert.equal(path.dirname(path.resolve(root)),path.resolve(tmpdir()));assert.ok(path.basename(root).startsWith('wg-stage6-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));return root;}
function fakeSocket(){
  const socket={events:new EventEmitter(),transport:new EventEmitter(),opened:false,buffering:true,closed:0,sends:[],downloads:0,
    isOpen(){return this.opened;},isBuffering(){return this.buffering;},async close(){this.closed++;this.opened=false;},async saveCredentials(){},reserveMessageId:()=>randomUUID(),
    async send(jid,payload,id,signal){signal.throwIfAborted();this.sends.push({jid,payload,id});return {key:{id,remoteJid:jid,fromMe:true},messageTimestamp:Math.floor(Date.now()/1000)};},
    async download(_message,signal){this.downloads++;signal.throwIfAborted();return (async function*(){yield png;})();}};
  return socket;
}
async function fixture(t,settings={}){
  const f=await conversationsFixture(t),root=await directory(t),config=new ConfigService({WHATSAPP_MEDIA_DIR:root,WHATSAPP_INTEGRATION_ENABLED:true,
    WHATSAPP_INTEGRATION_ALLOW_SEND:true,WHATSAPP_RECONNECT_BASE_MS:5,WHATSAPP_RECONNECT_MAX_MS:10,...settings});
  const policy=new IntegrationPolicy(config),filePolicy=new FilePolicy(config),storage=new PrivateFileStorage(filePolicy),files=new MessageFilesService(f.database,storage,filePolicy),
    messages=new MessagesService(f.records,files,filePolicy,f.conversations),receipts=new MessageReceiptsService(f.database),store=new MemoryStore(),events=new DomainEvents(),observed=[];
  events.subscribe(event=>observed.push(event));
  const incoming=new IncomingPipeline(store,messages,files,receipts,policy,filePolicy,f.database,events),sockets=[],factory={
    async open(){const value=fakeSocket();sockets.push(value);return value;},async release(){},async qrDataUrl(){return 'data:image/png;base64,bW9jaw==';}};
  const registry={async find(id){assert.ok(f.connectionIds.has(id));return{id,isActive:true};},async list(){return [...f.connectionIds].map(id=>({id,isActive:true}));}};
  const manager=new ConnectionManager(policy,registry,factory,store,incoming,events);t.after(()=>manager.onModuleDestroy());
  const metrics=new ReceiveMetrics();
  const accept=(batch,socket=sockets[0]??fakeSocket())=>incoming.accept(f.connectionId,batch,socket,Date.now(),metrics);
  const start=async()=>{await manager.start(f.connectionId);const socket=sockets.at(-1);socket.opened=true;socket.events.emit('connection.update',{connection:'open'});await tick();return socket;};
  const outbound=new BaileysOutboundAdapter(manager,policy,store,messages,f.conversations,storage,filePolicy,events);
  return {...f,root,config,policy,filePolicy,storage,files,messages,receipts,store,events,observed,incoming,sockets,factory,registry,manager,metrics,accept,start,outbound};
}
test('individual, group, self and mixed batch preserve original identifiers and direction',async t=>{
  const f=await fixture(t);await f.accept({type:'notify',messages:[raw('one'),raw('group',{key:{id:'group',remoteJid:'123-456@g.us',participant:'777@lid',fromMe:false}}),raw('self',{key:{id:'self',remoteJid:'12345@lid',fromMe:true}})]});
  assert.equal(f.state.get(Message).length,3);assert.equal(f.state.get(Message).filter(m=>m.fromMe).length,1);
  assert.equal(f.state.get(Conversation).filter(c=>c.remoteJid==='123-456@g.us').length,1);
  const group=f.state.get(Message).find(m=>m.whatsappMessageId==='group');assert.equal((await f.store.get('message-metadata',group.id)).sender,'777@lid');
});
test('duplicate and concurrent batches persist once, emit once and preserve chronology',async t=>{
  const f=await fixture(t),recent=raw('new'),old=raw('old',{messageTimestamp:1});
  await Promise.all([f.accept({type:'notify',messages:[recent,old]}),f.accept({type:'notify',messages:[recent]})]);
  assert.equal(f.state.get(Message).length,2);assert.equal(f.metrics.counters.message_duplicate,1);assert.equal(f.observed.filter(e=>e.type==='message.created').length,2);
  const conversation=f.state.get(Conversation).find(c=>c.remoteJid==='12345@lid');assert.equal(conversation.lastMessageAt.getTime(),recent.messageTimestamp*1000);
  const history=await f.conversations.findMessages(conversation.id,{page:1,pageSize:10});assert.deepEqual(history.items.map(m=>m.whatsappMessageId),['old','new']);
});
test('append, replayed notify and missing timestamps cannot count as realtime reception',async t=>{
  const f=await fixture(t),epoch=Date.now();
  for(const [type,value,classification]of [['append',raw('a'),'history'],['notify',raw('b',{messageTimestamp:1}),'history'],['notify',raw('c',{messageTimestamp:null}),'unknown_time'],['notify',raw('d',{messageTimestamp:{low:Math.floor(epoch/1000),high:0}}),'recent']]){
    assert.equal(normalizeProviderMessage(f.connectionId,value,type,epoch,false).classification,classification);
  }
  await f.accept({type:'append',messages:[raw('old')]});assert.equal(f.metrics.counters.recent_candidate,undefined);
});
test('LID alias supplied by provider reuses existing PN; conflicting conversations are retained',async t=>{
  const f=await fixture(t),conversation=f.seedConversation({remoteJid:'999@s.whatsapp.net'});
  await f.accept({type:'notify',messages:[raw('lid',{key:{id:'lid',remoteJid:'12345@lid',remoteJidAlt:'999@s.whatsapp.net',fromMe:false}}),raw('follow')]});
  assert.equal(f.state.get(Message).filter(m=>m.conversationId===conversation.id).length,2);
  assert.equal(f.state.get(Conversation).filter(c=>c.remoteJid==='12345@lid').length,0);
  f.seedConversation({remoteJid:'888@lid'});await f.accept({type:'notify',messages:[raw('conflict',{key:{id:'conflict',remoteJid:'888@lid',remoteJidAlt:'999@s.whatsapp.net',fromMe:false}})]});
  assert.equal((await f.store.entries('pending')).length,1);assert.equal(f.metrics.lastError.code,'IDENTITY_MAPPING_CONFLICT');
});
test('a temporary SQL failure retains the item, advances batch and recovers idempotently after process recreation',async t=>{
  const f=await fixture(t),ingest=f.messages.ingest.bind(f.messages);let first=true;
  f.messages.ingest=async(...args)=>{if(first){first=false;throw Object.assign(new Error('sensitive'),{driverError:{number:1205}});}return ingest(...args);};
  await f.accept({type:'notify',messages:[raw('retry'),raw('next')]});
  assert.equal(f.state.get(Message).length,1);assert.equal((await f.store.entries('pending')).length,1);assert.equal(f.metrics.lastError.code,1205);
  const replacement=new IncomingPipeline(f.store,f.messages,f.files,f.receipts,f.policy,f.filePolicy,f.database,f.events);
  await replacement.recover(f.connectionId,fakeSocket(),new ReceiveMetrics());assert.equal(f.state.get(Message).length,2);assert.equal((await f.store.entries('pending')).length,0);
});
test('entire batch is journaled before its first message starts processing',async t=>{
  const f=await fixture(t),ingest=f.messages.ingest.bind(f.messages);let observed=false;
  f.messages.ingest=async(...args)=>{if(!observed){observed=true;assert.equal((await f.store.entries('pending')).length,3);}return ingest(...args);};
  await f.accept({type:'notify',messages:[raw('a'),raw('b'),raw('c')]});assert.equal(f.state.get(Message).length,3);
});
test('media failure preserves caption and metadata; redelivery repairs it without overwriting a ready file',async t=>{
  const f=await fixture(t),socket=fakeSocket();socket.download=async()=>{throw Object.assign(new Error('private URL'),{code:'ETIMEDOUT'});};
  const message=raw('image',{message:{imageMessage:{mimetype:'image/png',fileName:'mock.png',caption:'private caption'}}});
  await f.accept({type:'notify',messages:[message]},socket);assert.equal(f.state.get(Message)[0].textContent,'private caption');assert.equal(f.state.get(Media)[0].availability,'failed');
  const good=fakeSocket();await f.accept({type:'notify',messages:[message]},good);assert.equal(f.state.get(Media)[0].availability,'ready');assert.equal(good.downloads,1);
  const key=f.state.get(Media)[0].storageKey;await f.accept({type:'notify',messages:[message]},good);assert.equal(good.downloads,1);assert.equal(f.state.get(Media)[0].storageKey,key);
});
test('audio, video and PDF reuse Stage 5 policies and SQL-compatible media kinds',async t=>{
  const f=await fixture(t),samples=[['audioMessage',{mimetype:'audio/ogg',fileName:'voz.ogg',seconds:2},Buffer.from('OggSfixture'),'audio'],
    ['videoMessage',{mimetype:'video/mp4',fileName:'video.mp4'},Buffer.concat([Buffer.from([0,0,0,24]),Buffer.from('ftypisom0000')]),'video'],
    ['documentMessage',{mimetype:'application/pdf',fileName:'doc.pdf'},Buffer.from('%PDF-1.7\nmock\n%%EOF'),'document']];
  for(const [type,meta,bytes,kind]of samples){const socket=fakeSocket();socket.download=async()=> (async function*(){yield bytes;})();await f.accept({type:'notify',messages:[raw(kind,{message:{[type]:meta}})]},socket);}
  assert.equal(f.state.get(Media).length,3);assert.ok(f.state.get(Media).every(m=>m.availability==='ready'));assert.equal(f.state.get(Message).find(m=>m.whatsappMessageId==='video').messageType,'video');
  assert.equal(f.state.get(Media).filter(m=>m.kind==='document').length,2);
});
test('receipts before messages survive and read/delivered states never regress',async t=>{
  const f=await fixture(t),key={id:'own',remoteJid:'12345@lid',fromMe:true};
  await f.incoming.updates(f.connectionId,[{key,update:{status:4}}],f.metrics);assert.equal((await f.store.entries('receipts')).length,1);
  await f.accept({type:'notify',messages:[raw('own',{key})]});await f.incoming.recoverReceipts(f.connectionId);
  await f.incoming.updates(f.connectionId,[{key,update:{status:3}},{key,update:{status:0}}],f.metrics);
  assert.equal(f.state.get(Message)[0].status,'read');
});
test('concurrent starts share exactly one socket; separate connections remain isolated',async t=>{
  const f=await fixture(t);await Promise.all(Array.from({length:10},()=>f.manager.start(f.connectionId)));assert.equal(f.sockets.length,1);
  const second=randomUUID();f.connectionIds.add(second);await f.manager.start(second);assert.equal(f.sockets.length,2);
  await f.manager.stop(f.connectionId);assert.equal(f.sockets[0].closed,1);assert.equal(f.sockets[1].closed,0);
});
test('websocket open remains sync_pending until actual pending flag and buffer release are observed',async t=>{
  const f=await fixture(t),socket=await f.start();let status=f.manager.status(f.connectionId);
  assert.equal(status.websocketOpen,true);assert.equal(status.syncComplete,false);assert.equal(status.receiveHealth,'sync_pending');
  socket.events.emit('connection.update',{receivedPendingNotifications:true});assert.equal(f.manager.status(f.connectionId).syncComplete,false);
  socket.transport.emit('CB:ib,,offline',{});socket.buffering=false;status=f.manager.status(f.connectionId);assert.equal(status.syncComplete,true);assert.ok(status.offlineTerminalAt);
});
test('temporary disconnect reconnects with a budget; logout blocks restore without deleting credentials',async t=>{
  const f=await fixture(t),socket=await f.start();await f.store.put('auth','sentinel',{secret:'preserve'});
  socket.events.emit('connection.update',{connection:'close',lastDisconnect:{error:{output:{statusCode:408}}}});await new Promise(r=>setTimeout(r,30));
  assert.equal(f.sockets.length,2);assert.equal(socket.closed,1);
  f.sockets[1].events.emit('connection.update',{connection:'close',lastDisconnect:{error:{output:{statusCode:401}}}});await tick();
  assert.equal(f.manager.status(f.connectionId).state,'disconnected');assert.equal((await f.store.get('intent',f.connectionId)).blocked,true);assert.deepEqual(await f.store.get('auth','sentinel'),{secret:'preserve'});
  await assert.rejects(()=>f.manager.start(f.connectionId),e=>e.code==='SESSION_INTERVENTION_REQUIRED');
});
test('manual stop cancels scheduled reconnect and preserves disabled restore intent on restart',async t=>{
  const f=await fixture(t,{WHATSAPP_RECONNECT_BASE_MS:50}),socket=await f.start();
  socket.events.emit('connection.update',{connection:'close',lastDisconnect:{error:{output:{statusCode:408}}}});await tick();await f.manager.stop(f.connectionId);
  await new Promise(r=>setTimeout(r,60));assert.equal(f.sockets.length,1);
  const policy=new IntegrationPolicy(new ConfigService({WHATSAPP_INTEGRATION_ENABLED:true,WHATSAPP_INTEGRATION_AUTO_RESTORE:true}));
  const replacement=new ConnectionManager(policy,f.registry,f.factory,f.store,f.incoming,f.events);await replacement.restore();assert.equal(f.sockets.length,1);await replacement.onModuleDestroy();
});
test('send simulation confirms provider ID, attendance authorization and request idempotency',async t=>{
  const f=await fixture(t),socket=await f.start(),conv=f.seedConversation({remoteJid:'987@lid',attendanceStatus:'in_progress',assignedUserId:f.admin.id});
  const request={conversationId:conv.id,actor:f.admin,key:randomUUID(),text:'private simulated send'};
  const [a,b]=await Promise.all([f.outbound.send(request),f.outbound.send(request)]);
  assert.equal(socket.sends.length,1);assert.equal(a.id,b.id);assert.equal(a.whatsappMessageId,socket.sends[0].id);assert.equal(a.status,'sent');
  await assert.rejects(()=>f.outbound.send({...request,text:'changed'}),e=>e.getStatus()===409);
  await assert.rejects(()=>f.outbound.send({...request,key:randomUUID(),actor:f.regular}),e=>e.getStatus()===403);
});
test('confirmed provider ACK plus SQL failure retries persistence without repeating send',async t=>{
  const f=await fixture(t),socket=await f.start(),conv=f.seedConversation({remoteJid:'987@lid',attendanceStatus:'in_progress',assignedUserId:f.admin.id}),request={conversationId:conv.id,actor:f.admin,key:randomUUID(),text:'mock'};
  f.faults.set(Message,new Error('mock SQL outage'));await assert.rejects(()=>f.outbound.send(request));assert.equal(socket.sends.length,1);
  f.faults.delete(Message);await f.outbound.send(request);assert.equal(socket.sends.length,1);assert.equal(f.state.get(Message).length,1);
});
test('uncertain send survives adapter recreation and is never automatically sent again',async t=>{
  const f=await fixture(t),socket=await f.start(),conv=f.seedConversation({remoteJid:'987@lid',attendanceStatus:'in_progress',assignedUserId:f.admin.id});let calls=0;
  socket.send=async()=>{calls++;throw Object.assign(new Error('private failure'),{code:'ETIMEDOUT'});};
  const request={conversationId:conv.id,actor:f.admin,key:randomUUID(),text:'mock'};await assert.rejects(()=>f.outbound.send(request),e=>e.code==='SEND_CONFIRMATION_UNCERTAIN');
  const replacement=new BaileysOutboundAdapter(f.manager,f.policy,f.store,f.messages,f.conversations,f.storage,f.filePolicy,f.events);
  await assert.rejects(()=>replacement.send(request),e=>e.getStatus()===409);assert.equal(calls,1);assert.equal(f.state.get(Message).length,0);
});
test('logs expose stage/code/time/hash but no contents, JIDs, credentials or raw errors',()=>{
  const values=[],metrics=new ReceiveMetrics(value=>values.push(value));metrics.event('message_processing','sensitive-original-id',10);metrics.error('download_failed',{code:'ETIMEDOUT',message:'credential private text',url:'private'});
  const output=JSON.stringify(values);assert.ok(!/sensitive-original-id|credential|private/.test(output));assert.equal(values[1].code,'ETIMEDOUT');assert.equal(values[0].messageRef.length,20);
});
test('SSE access rechecks current assignment, connection and disabled accounts',async t=>{
  const f=await fixture(t),access=new RealtimeAccess(f.database),conv=f.seedConversation({remoteJid:'987@lid',assignedUserId:f.regular.id});
  assert.equal(await access.allowed(f.regular.id,{conversationId:conv.id,connectionId:f.connectionId},f.connectionId),true);
  assert.equal(await access.allowed(f.other.id,{conversationId:conv.id},f.connectionId),false);
  assert.equal(await access.allowed(f.regular.id,{conversationId:conv.id,connectionId:randomUUID()},f.connectionId),false);
  f.state.get(Conversation).find(c=>c.id===conv.id).assignedUserId=f.other.id;assert.equal(await access.allowed(f.regular.id,{conversationId:conv.id},f.connectionId),false);
  f.state.get(User).find(u=>u.id===f.admin.id).isActive=false;await assert.rejects(()=>access.allowed(f.admin.id,{}),e=>e.getStatus()===401);
});
test('sealed state survives recreation, hides message contents and refuses a lost encryption key',async t=>{
  const root=await directory(t),config=new ConfigService({WHATSAPP_INTEGRATION_STATE_DIR:root}),store=new EncryptedStateStore(config);
  await store.put('pending','private-message-id',{text:'secret content',bytes:Buffer.from('private')});
  const files=await fs.readdir(root),encrypted=files.find(name=>name.endsWith('.enc'));
  assert.ok(!(await fs.readFile(path.join(root,encrypted))).includes(Buffer.from('secret content')));
  const replacement=new EncryptedStateStore(config);assert.deepEqual((await replacement.get('pending','private-message-id')).bytes,Buffer.from('private'));
  // Only this explicitly named temporary test key is removed; never real auth.
  await fs.unlink(path.join(root,'master.key'));const missing=new EncryptedStateStore(config);
  await assert.rejects(()=>missing.put('pending','other',{}),/STATE_KEY_MISSING/);assert.equal((await fs.readdir(root)).includes('master.key'),false);
});
test('factory without an existing session fails closed; disabled integration loads no SDK',async t=>{
  const root=await directory(t),id=randomUUID(),config=new ConfigService({WHATSAPP_INTEGRATION_STATE_DIR:root,WHATSAPP_SESSIONS_DIR:path.join(root,'legacy'),WHATSAPP_INTEGRATION_ENABLED:true}),store=new MemoryStore();let loads=0;
  const factory=new BaileysSocketFactory(config,new IntegrationPolicy(config),store,async()=>{loads++;return {};});
  await assert.rejects(()=>factory.open(id,false),e=>e.code==='EXISTING_SESSION_NOT_FOUND');assert.equal(loads,1);assert.equal((await fs.readdir(root)).some(name=>name.endsWith('.lock')),false);
  const disabled=new BaileysSocketFactory(config,new IntegrationPolicy(new ConfigService({})),store,async()=>{throw new Error('should not load');});
  await assert.rejects(()=>disabled.open(id,false),e=>e.code==='WHATSAPP_INTEGRATION_DISABLED');assert.equal(loads,1);
});
test('factory preserves original credentials, uses sealed auth writes and enforces a process lease',async t=>{
  const root=await directory(t),id=randomUUID(),legacy=path.join(root,'legacy'),sessionDirectory=path.join(legacy,id);await fs.mkdir(sessionDirectory,{recursive:true});
  const original=Buffer.from(JSON.stringify({registered:true,me:{id:'123@s.whatsapp.net'},mock:'original'}));await fs.writeFile(path.join(sessionDirectory,'creds.json'),original);
  const config=new ConfigService({WHATSAPP_INTEGRATION_STATE_DIR:root,WHATSAPP_SESSIONS_DIR:legacy,WHATSAPP_INTEGRATION_ENABLED:true}),store=new MemoryStore();let options;
  const sdk={default:value=>{options=value;return{ev:new EventEmitter(),ws:Object.assign(new EventEmitter(),{isOpen:true}),end(){}};}};
  const a=new BaileysSocketFactory(config,new IntegrationPolicy(config),store,async()=>sdk),b=new BaileysSocketFactory(config,new IntegrationPolicy(config),store,async()=>sdk),socket=await a.open(id,false);
  await assert.rejects(()=>b.open(id,false),e=>e.code==='SOCKET_LEASE_EXISTS');options.auth.creds.mock='updated';await socket.saveCredentials();await options.auth.keys.set({'session':{'key':null}});
  assert.deepEqual(await fs.readFile(path.join(sessionDirectory,'creds.json')),original);assert.equal((await store.get('auth',id+'|creds')).mock,'updated');
  await socket.close();await a.release(id);assert.equal((await fs.readdir(root)).some(name=>name.endsWith('.lock')),false);
});
test('HTTP module remains inert by default, requires JWT and keeps unavailable sends at 503',async t=>{
  const f=await conversationsFixture(t,true,{STAGE6_INTEGRATION:true});
  assert.equal((await f.call('/whatsapp-connections')).status,401);
  const bearer=await f.token(f.admin);
  const connect=await f.call(`/whatsapp-connections/${f.connectionId}/connect`,{bearer,method:'POST',body:{}});assert.equal(connect.status,503);assert.equal(connect.body.code,'WHATSAPP_INTEGRATION_DISABLED');
  assert.equal((await f.call(`/whatsapp-conversations/${f.conversation.id}/messages`,{bearer,method:'POST',body:{}})).status,503);
  assert.equal((await f.call('/whatsapp-events?token=forbidden',{bearer})).status,401);
  const controller=new AbortController(),response=await fetch((await f.app.getUrl())+'/whatsapp-events',{headers:{Authorization:'Bearer '+bearer},signal:controller.signal});assert.equal(response.status,200);
  const reader=response.body.getReader(),first=await reader.read();assert.match(Buffer.from(first.value).toString(),/resync_required/);controller.abort();await reader.cancel().catch(()=>{});
  assert.equal(f.writes.length,0);
});
test('SDK transport return alone cannot confirm send; matching remote ACK is required and listeners are cleaned',async()=>{
  const provider={ws:new EventEmitter(),ev:new EventEmitter(),async sendMessage(jid,_payload,{messageId}){return{key:{id:messageId,remoteJid:jid,fromMe:true}};}};
  const controller=new AbortController();let complete=false;
  const sent=sendWithRemoteAck(provider,'123@lid',{text:'mock'},'original',controller.signal).then(value=>{complete=true;return value;});
  await tick();assert.equal(complete,false);provider.ws.emit('CB:ack,class:message',{attrs:{id:'other'}});await tick();assert.equal(complete,false);
  provider.ws.emit('CB:ack,class:message',{attrs:{id:'original'}});assert.equal((await sent).key.id,'original');assert.equal(provider.ws.listenerCount('CB:ack,class:message'),0);
  const aborted=sendWithRemoteAck(provider,'123@lid',{text:'mock'},'second',controller.signal);controller.abort(new Error('mock abort'));
  await assert.rejects(()=>aborted,/mock abort/);assert.equal(provider.ev.listenerCount('connection.update'),0);
});
test('ciphertext stub remains private and a later decrypted redelivery can persist the same original ID',async t=>{
  const f=await fixture(t);await f.accept({type:'notify',messages:[raw('decrypt',{message:undefined,messageStubType:2})]});
  assert.equal(f.state.get(Message).length,0);assert.equal((await f.store.entries('pending')).length,1);
  await f.accept({type:'notify',messages:[raw('decrypt')]});assert.equal(f.state.get(Message).length,1);assert.equal((await f.store.entries('pending')).length,0);
});
test('unexpected QR during session restore closes the mock socket without encoding or deleting credentials',async t=>{
  const f=await fixture(t),socket=await f.start();let encoded=0;f.factory.qrDataUrl=async()=>{encoded++;return 'should not happen';};
  socket.events.emit('connection.update',{qr:'private mock QR'});await tick();assert.equal(encoded,0);assert.equal(socket.closed,1);assert.equal(f.manager.status(f.connectionId).state,'error');
});
test('receipt notifications reach the assigned SSE reader with scoped IDs and no message content',async t=>{
  const f=await fixture(t),conv=f.seedConversation({remoteJid:'12345@lid',assignedUserId:f.regular.id}),key={id:'receipt-own',remoteJid:'12345@lid',fromMe:true};
  await f.accept({type:'notify',messages:[raw(key.id,{key})]});await f.incoming.updates(f.connectionId,[{key,update:{status:4}}],f.metrics);
  const event=f.observed.find(value=>value.type==='message.changed');assert.equal(event.conversationId,conv.id);
  const access=new RealtimeAccess(f.database);assert.equal(await access.allowed(f.regular.id,event,f.connectionId),true);assert.equal(await access.allowed(f.other.id,event,f.connectionId),false);
  assert.equal(await access.allowed(f.regular.id,{type:'connection.changed',connectionId:f.connectionId},f.connectionId),true);
  assert.deepEqual(Object.keys(event).sort(),['at','connectionId','conversationId','messageId','type']);
});
test('simulated image/audio/video/PDF/document sends retain media and send each key only once',async t=>{
  const f=await fixture(t),socket=await f.start(),conv=f.seedConversation({remoteJid:'987@lid',attendanceStatus:'in_progress',assignedUserId:f.admin.id});
  const files=[{content:png,metadata:{kind:'image',mimeType:'image/png',originalName:'mock.png'}},
    {content:Buffer.from('OggSfixture'),metadata:{kind:'audio',mimeType:'audio/ogg',originalName:'voz.ogg'}},
    {content:Buffer.concat([Buffer.from([0,0,0,24]),Buffer.from('ftypisom0000')]),metadata:{kind:'video',mimeType:'video/mp4',originalName:'mock.mp4'}},
    {content:Buffer.from('%PDF-1.7\nfixture\n%%EOF'),metadata:{kind:'document',mimeType:'application/pdf',originalName:'mock.pdf'}},
    {content:Buffer.from('private test document'),metadata:{kind:'document',mimeType:'text/plain',originalName:'mock.txt'}}];
  for(const file of files){const request={conversationId:conv.id,actor:f.admin,key:randomUUID(),file};await f.outbound.send(request);await f.outbound.send(request);}
  assert.equal(socket.sends.length,5);assert.equal(f.state.get(Message).length,5);assert.equal(f.state.get(Media).length,5);assert.ok(f.state.get(Media).every(value=>value.availability==='ready'));
});
