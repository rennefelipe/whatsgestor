const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { tmpdir } = require('node:os');
const { randomUUID } = require('node:crypto');
const { ConfigService } = require('@nestjs/config');
const { FilePolicy } = require('../dist/messages/file-policy');
const { PrivateFileStorage } = require('../dist/messages/private-file-storage');
const { MessageFilesService } = require('../dist/messages/message-files.service');
const { MessagesService, MessageReceiptsService } = require('../dist/messages/messages.service');
const { FileUploadGuard, byteRange } = require('../dist/messages/messages.controller');
const { conversationsFixture, Conversation, Message, Media } = require('./helpers/conversations-fixture.cjs');
const status = (code) => (error) => error.getStatus?.() === code;
const png = Buffer.from([137,80,78,71,13,10,26,10,0,1,2,3]);
const pdf = Buffer.from('%PDF-1.7\nfixture\n%%EOF');
const metadata = { kind: 'image', mimeType: 'image/png', originalName: 'ação.png', width: 16, height: 8 };
const input = (f, values = {}) => ({ connectionId: f.connectionId, remoteJid: f.conversation.remoteJid,
  whatsappMessageId: 'provider-original-id', fromMe: false, origin: 'live', messageType: 'text',
  textContent: 'isolated text fixture', messageTimestamp: new Date('2026-10-01T12:00:00Z'), ...values });
async function directory(t) {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'wg-stage5-'));
  assert.equal(path.dirname(path.resolve(root)), path.resolve(tmpdir()));
  assert.ok(path.basename(root).startsWith('wg-stage5-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}
async function fixture(t, http = false, settings = {}) {
  const root = await directory(t);
  const config = { WHATSAPP_MEDIA_DIR: root, ...settings };
  const f = await conversationsFixture(t, http, config);
  const policy = new FilePolicy(new ConfigService(config));
  const storage = new PrivateFileStorage(policy);
  const files = new MessageFilesService(f.database, storage, policy);
  return { ...f, root, policy, storage, files,
    messages: new MessagesService(f.records, files, policy, f.conversations), receipts: new MessageReceiptsService(f.database) };
}
function office(extension, names, flags = 0, inflated = 0) {
  names ??= ['[Content_Types].xml', { '.docx': 'word/document.xml', '.xlsx': 'xl/workbook.xml', '.pptx': 'ppt/presentation.xml' }[extension]];
  const locals = [], central = []; let offset = 0;
  for (const name of names) {
    const n = Buffer.from(name), local = Buffer.alloc(30), c = Buffer.alloc(46), data = Buffer.from('<x/>');
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(flags, 6); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(n.length, 26);
    c.writeUInt32LE(0x02014b50); c.writeUInt16LE(flags, 8); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(inflated || data.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(offset, 42);
    locals.push(local, n, data); central.push(c, n); offset += local.length + n.length + data.length;
  }
  const end = Buffer.alloc(22), tail = Buffer.concat(central);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(names.length, 8); end.writeUInt16LE(names.length, 10); end.writeUInt32LE(tail.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, tail, end]);
}

test('file allowlist validates MIME, names, signatures and Office containers without execution', () => {
  const policy = new FilePolicy(new ConfigService({}));
  const mp4 = Buffer.concat([Buffer.from([0,0,0,24]), Buffer.from('ftypisom0000')]);
  const samples = [
    [png, metadata], [pdf, { kind:'document',mimeType:'application/pdf',originalName:'documento.pdf' }],
    [Buffer.from('OggSfixture'), { kind:'audio',mimeType:'audio/ogg; codecs=opus',originalName:'voz.ogg' }],
    [Buffer.from('ID3fixture'), { kind:'audio',mimeType:'audio/mpeg',originalName:'voz.mp3' }],
    [mp4, { kind:'video',mimeType:'video/mp4',originalName:'video.mp4' }],
    [Buffer.from('Olá, arquivo UTF-8'), { kind:'document',mimeType:'text/plain',originalName:'texto.txt' }],
    [Buffer.from('nome,valor\na,1'), { kind:'document',mimeType:'text/csv',originalName:'planilha.csv' }],
  ];
  for (const extension of ['.docx','.xlsx','.pptx']) {
    const mime = Object.entries(policy.capabilities().formats).find(([,format]) => format.extensions.includes(extension))[0];
    samples.push([office(extension), {kind:'document',mimeType:mime,originalName:'arquivo'+extension}]);
  }
  for (const [content, m] of samples) {
    const result = policy.validate(content, m);
    assert.equal(result.sizeBytes, content.length); assert.equal(result.sha256.length, 64); assert.equal(result.originalName, m.originalName); assert.equal(result.mimeType,m.mimeType);
  }
});

test('files reject traversal, active types, MIME mismatch, malformed documents and configurable limits', () => {
  const policy = new FilePolicy(new ConfigService({ MESSAGES_IMAGE_MAX_BYTES: 16, MESSAGES_TEXT_MAX_LENGTH: 5 }));
  for (const name of ['../x.png','x\\x.png','x\r\n.png','x.png.exe','x.png.','x:ads.png']) assert.throws(() => policy.validate(png,{...metadata,originalName:name}), status(400));
  assert.throws(() => policy.validate(Buffer.from('<html/>'), metadata), status(415));
  assert.throws(() => policy.validate(png,{...metadata,mimeType:'image/svg+xml'}), status(415));
  assert.throws(() => policy.validate(Buffer.alloc(17),metadata),status(413));
  assert.throws(() => policy.validate(Buffer.alloc(0),metadata),status(400));
  assert.throws(() => policy.metadata({...metadata,durationSeconds:-1}),status(400));
  assert.throws(() => policy.text('123456'),status(413));
  assert.equal(policy.text(' a '),' a ');
  assert.throws(() => new FilePolicy(new ConfigService({MESSAGES_VIDEO_MAX_BYTES:20971521})),/MESSAGES_VIDEO_MAX_BYTES/);
  assert.throws(() => new FilePolicy(new ConfigService({MESSAGES_FILE_CONCURRENCY:0})),/MESSAGES_FILE_CONCURRENCY/);
  const doc = {kind:'document',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',originalName:'x.docx'};
  for (const bytes of [Buffer.from('PKfake'), office('.docx',['../evil']), office('.docx',undefined,1),
    office('.docx',undefined,0,99999999), office('.docx',['[Content_Types].xml','word/document.xml','word/vbaProject.bin'])]) assert.throws(()=>policy.validate(bytes,doc),status(415));
});

test('private storage atomically saves opaque keys and preserves legacy UUID .bin files', async(t)=>{
  const f=await fixture(t);const saved=await f.storage.save(png,metadata);
  assert.match(saved.key,/^[0-9a-f-]{36}\.bin$/);assert.equal(saved.key.includes('ação'),false);
  const opened=await f.storage.open(saved.key);
  assert.deepEqual(await opened.handle.readFile(),png);await opened.handle.close();
  assert.equal((await f.storage.extra(saved.key)).width,16);assert.equal(await f.storage.digest(saved.key),saved.sha256);
  const legacy=randomUUID()+'.bin';await fs.writeFile(path.join(f.root,legacy),pdf,{mode:0o600});
  assert.deepEqual(await f.storage.extra(legacy),{});
  const old=await f.storage.open(legacy);assert.equal(old.size,pdf.length);await old.handle.close();
  for(const key of ['../secret','x.bin','C:\\secret',saved.key+'.part']) await assert.rejects(f.storage.open(key),status(404));
  assert.equal((await fs.readdir(f.root)).some(n=>n.endsWith('.part')),false);
  assert.throws(()=>new PrivateFileStorage(new FilePolicy(new ConfigService({WHATSAPP_MEDIA_DIR:path.resolve(__dirname,'..','public')}))),/fora do projeto/);
});

test('storage rejects hardlinks and directory redirection without exposing target bytes',async(t)=>{
  const f=await fixture(t), saved=await f.storage.save(png,metadata);
  const alias=path.join(f.root,randomUUID()+'.bin');await fs.link(path.join(f.root,saved.key),alias);
  await assert.rejects(f.storage.open(saved.key),status(404));await fs.unlink(alias);
  const redirected=path.join(f.root,'redirected'), target=path.join(f.root,'target');await fs.mkdir(target);
  try { await fs.symlink(target,redirected,process.platform==='win32'?'junction':'dir'); }
  catch(e){if(['EPERM','EACCES'].includes(e.code))return;throw e;}
  const storage=new PrivateFileStorage(new FilePolicy(new ConfigService({WHATSAPP_MEDIA_DIR:redirected})));
  await assert.rejects(storage.save(png,metadata),status(503));assert.deepEqual(await fs.readdir(target),[]);
  const nested=new PrivateFileStorage(new FilePolicy(new ConfigService({WHATSAPP_MEDIA_DIR:path.join(redirected,'must-not-be-created')})));
  await assert.rejects(nested.save(png,metadata),status(503));assert.deepEqual(await fs.readdir(target),[]);
});

test('text ingress is idempotent across reconnect instances and retains exact provider identities',async(t)=>{
  const f=await fixture(t);const event=input(f);
  const first=await f.messages.ingest(event);
  const restored=new MessagesService(f.records,f.files,f.policy,f.conversations);
  const again=await restored.ingest({...event,status:'read'});
  assert.equal(first.message.id,again.message.id);assert.equal(again.message.whatsappMessageId,event.whatsappMessageId);
  assert.equal(f.state.get(Message).length,1);assert.equal(again.message.status,'received');
  await assert.rejects(f.messages.ingest(input(f,{status:'invented'})),status(400));
});

test('recording owns mutable input identities and dates across asynchronous work',async(t)=>{
  const f=await fixture(t);const event=input(f);const originalDate=event.messageTimestamp.getTime();
  const transaction=f.database.transaction;let release;const gate=new Promise(r=>release=r);
  f.database.transaction=async(...args)=>{await gate;return transaction(...args)};
  const result=f.records.record(event);event.whatsappMessageId='mutated-after-dispatch';event.messageTimestamp.setUTCFullYear(2000);release();
  const message=await result;assert.equal(message.whatsappMessageId,'provider-original-id');assert.equal(message.messageTimestamp.getTime(),originalDate);
});

test('concurrent attachment retries produce one SQL metadata row and retain original filename',async(t)=>{
  const f=await fixture(t);const message=await f.records.record(input(f,{messageType:'image',textContent:null}));
  await Promise.all([f.files.attach(message.conversationId,message.id,png,metadata),f.files.attach(message.conversationId,message.id,png,metadata)]);
  assert.equal(f.state.get(Media).length,1);assert.equal((await fs.readdir(f.root)).filter(x=>x.endsWith('.bin')).length,1);
  const row=f.state.get(Media)[0];assert.equal(row.originalName,'ação.png');assert.equal(row.sizeBytes,png.length);
  assert.equal((await f.files.metadata(message.conversationId,message.id)).width,16);
  await assert.rejects(f.files.attach(message.conversationId,message.id,Buffer.concat([png,Buffer.from('changed')]),metadata),status(409));
  const extra=f.seedConversation();await assert.rejects(f.files.file(extra.id,message.id),status(404));
});

test('video fits legacy SQL document kind without losing video type or MIME',async(t)=>{
  const f=await fixture(t);const bytes=Buffer.concat([Buffer.from([0,0,0,24]),Buffer.from('ftypisomfixture')]);
  const result=await f.messages.ingest(input(f,{messageType:'video',textContent:null}),{content:bytes,metadata:{kind:'video',mimeType:'video/mp4',originalName:'video.mp4'}});
  assert.equal(result.message.messageType,'video');assert.equal(f.state.get(Media)[0].kind,'document');
  assert.equal(result.media.semanticKind,'video');assert.equal(result.media.mimeType,'video/mp4');
});

test('invalid received file preserves its message and failed metadata; a valid redelivery repairs it once',async(t)=>{
  const f=await fixture(t), event=input(f,{messageType:'image',textContent:null});
  await assert.rejects(f.messages.ingest(event,{metadata,content:Buffer.from('not-a-png')}),status(415));
  assert.equal(f.state.get(Message).length,1);assert.equal(f.state.get(Media).length,1);
  assert.equal(f.state.get(Media)[0].availability,'failed');assert.deepEqual(await fs.readdir(f.root),[]);
  await f.messages.ingest(event,{metadata,content:png});
  assert.equal(f.state.get(Message).length,1);assert.equal(f.state.get(Media).length,1);assert.equal(f.state.get(Media)[0].availability,'ready');
  await assert.rejects(f.messages.ingest(event,{metadata,content:Buffer.from('bad redelivery')}),status(415));
  assert.equal(f.state.get(Media)[0].availability,'ready');
});

test('SQL failure preserves the message and published private file; redelivery can recover metadata',async(t)=>{
  const f=await fixture(t);f.faults.set(Media,new Error('isolated SQL failure'));
  const event=input(f,{messageType:'image',textContent:null});
  await assert.rejects(f.messages.ingest(event,{content:png,metadata}),/isolated SQL failure/);
  assert.equal(f.state.get(Message).length,1);assert.equal(f.state.get(Media).length,0);
  assert.equal((await fs.readdir(f.root)).filter(x=>x.endsWith('.bin')).length,1);
  f.faults.delete(Media);
  const orphan=(await fs.readdir(f.root)).find(x=>x.endsWith('.bin'));
  const message=f.state.get(Message)[0];
  await assert.rejects(f.files.recover(randomUUID(),message.id,orphan),status(404));
  await f.files.recover(message.conversationId,message.id,orphan);
  await f.messages.ingest(event,{content:png,metadata});
  assert.equal((await fs.readdir(f.root)).filter(x=>x.endsWith('.bin')).length,1);
  assert.equal(f.state.get(Message).length,1);assert.equal(f.state.get(Media).length,1);
});

test('receipts are scoped, monotonic, concurrency-safe and do not replay old status',async(t)=>{
  const f=await fixture(t);await f.messages.ingest(input(f,{fromMe:true,origin:'outgoing',status:'pending'}));
  const receipt={connectionId:f.connectionId,remoteJid:f.conversation.remoteJid,whatsappMessageId:'provider-original-id',fromMe:true,status:'sent'};
  await f.receipts.apply(receipt);await f.receipts.apply({...receipt,status:'failed'});
  assert.equal((await f.receipts.apply({...receipt,status:'delivered'})).status,'delivered');
  await Promise.all([f.receipts.apply({...receipt,status:'read'}),f.receipts.apply({...receipt,status:'sent'})]);
  assert.equal(f.state.get(Message)[0].status,'read');assert.equal((await f.receipts.apply({...receipt,status:'failed'})).changed,false);
  assert.equal((await f.receipts.apply({...receipt,connectionId:randomUUID()})).matched,false);
  assert.equal((await f.receipts.apply({...receipt,fromMe:false})).matched,false);
  assert.equal(f.state.get(Message).length,1);
});

test('preparation honors attendance permissions and never persists or queues a message',async(t)=>{
  const f=await fixture(t);
  await assert.rejects(f.messages.prepareText(f.conversation.id,'text',f.regular),status(403));
  await f.attendance.claim(f.conversation.id,f.regular.id);const writes=f.writes.length;
  const result=await f.messages.prepareText(f.conversation.id,' text ',f.regular);
  assert.equal(result.textContent,' text ');assert.equal(result.persisted,false);assert.equal(result.queued,false);
  await assert.rejects(f.messages.prepareText(f.conversation.id,'text',f.other),status(403));
  await assert.rejects(f.messages.unavailable(f.conversation.id),status(503));
  assert.equal(f.writes.length,writes);assert.deepEqual(await fs.readdir(f.root),[]);
});

test('range parsing supports single video/audio ranges and rejects malformed or excessive values',()=>{
  assert.deepEqual(byteRange('bytes=2-5',10),{start:2,end:5});assert.deepEqual(byteRange('bytes=-3',10),{start:7,end:9});
  assert.deepEqual(byteRange('bytes=5-',10),{start:5,end:9});assert.equal(byteRange(undefined,10),null);
  for(const r of ['bytes=20-','bytes=5-2','bytes=0-1,4-5','bytes=-0','bytes=-99999999999999999999'])assert.throws(()=>byteRange(r,10),status(400));
});

test('upload admission releases on close and actually cancels timed-out requests',async()=>{
  const {EventEmitter}=require('node:events');const policy=new FilePolicy(new ConfigService({MESSAGES_FILE_CONCURRENCY:1,MESSAGES_UPLOAD_TIMEOUT_MS:10}));
  const guard=new FileUploadGuard(policy,{authorizePreparation:async()=>undefined}),res=new EventEmitter();let destroyed=0;
  const context={switchToHttp:()=>({getResponse:()=>res,getRequest:()=>({params:{conversationId:randomUUID()},destroy:()=>{destroyed++;res.emit('close')}})})};
  assert.equal(await guard.canActivate(context),true);await assert.rejects(guard.canActivate(context),status(503));
  await new Promise(r=>setTimeout(r,30));assert.equal(destroyed,1);assert.equal(await guard.canActivate(context),true);res.emit('finish');
});

test('HTTP preparation and legacy routes enforce JWT and preserve disabled-provider errors',async(t)=>{
  const f=await fixture(t,true);const base='/whatsapp-conversations/'+f.conversation.id+'/messages';
  assert.equal((await f.call(base+'/capabilities')).status,401);
  const bearer=await f.token(f.regular);
  assert.equal((await f.call(base+'/prepare',{bearer,method:'POST',body:{textContent:'test'}})).status,403);
  await f.attendance.claim(f.conversation.id,f.regular.id);const writes=f.writes.length;
  assert.equal((await f.call(base+'/prepare',{bearer,method:'POST',body:{textContent:'test'}})).body.queued,false);
  assert.equal((await f.call(base+'/prepare',{bearer,method:'POST',body:{textContent:'test',extra:true}})).status,400);
  for(const suffix of ['', '/attachments', '/audio']){
    const result=await f.call(base+suffix,{bearer,method:'POST',body:{textContent:'test'}});
    assert.equal(result.status,503);assert.equal(result.body.code,'MESSAGE_PROVIDER_UNAVAILABLE');
  }
  assert.equal(f.writes.length,writes);assert.deepEqual(await fs.readdir(f.root),[]);
});

test('multipart preparation checks Unicode filenames, spoofing, missing files and byte limits without storage',async(t)=>{
  const settings=Object.fromEntries(['IMAGE','AUDIO','VIDEO','DOCUMENT'].map(k=>['MESSAGES_'+k+'_MAX_BYTES',64]));
  const f=await fixture(t,true,settings);await f.attendance.claim(f.conversation.id,f.regular.id);
  const bearer=await f.token(f.regular),url=(await f.app.getUrl())+'/whatsapp-conversations/'+f.conversation.id+'/messages/attachments/prepare';
  const upload=async(bytes,name,type)=>{const form=new FormData();if(bytes)form.append('file',new Blob([bytes],{type}),name);return fetch(url,{method:'POST',headers:{Authorization:'Bearer '+bearer},body:form})};
  let result=await upload(png,'ação.png','image/png');assert.equal(result.status,200);assert.equal((await result.json()).originalName,'ação.png');
  const otherBearer=await f.token(f.other);
  const unauthorizedForm=new FormData();unauthorizedForm.append('file',new Blob([Buffer.alloc(1024)],{type:'image/png'}),'large.png');
  assert.equal((await fetch(url,{method:'POST',headers:{Authorization:'Bearer '+otherBearer},body:unauthorizedForm})).status,403);
  result=await upload(Buffer.from('<script/>'),'x.png','image/png');assert.equal(result.status,415);
  result=await upload(Buffer.alloc(65),'large.png','image/png');assert.equal(result.status,413);
  result=await upload(null);assert.equal(result.status,400);
  assert.deepEqual(await fs.readdir(f.root),[]);
});

test('authenticated legacy media retrieval streams bytes/ranges without exposing keys or crossing conversations',async(t)=>{
  const f=await fixture(t,true);const event=input(f,{messageType:'image',textContent:null});
  const result=await f.messages.ingest(event,{metadata,content:png});const message=result.message;
  const url=(await f.app.getUrl())+'/whatsapp-conversations/'+f.conversation.id+'/messages/'+message.id+'/media';
  assert.equal((await fetch(url)).status,401);const token=await f.token(f.regular),headers={Authorization:'Bearer '+token};
  let response=await fetch(url,{headers});assert.equal(response.status,200);assert.deepEqual(Buffer.from(await response.arrayBuffer()),png);
  assert.equal(response.headers.get('x-content-type-options'),'nosniff');assert.match(response.headers.get('content-disposition'),/^attachment;/);
  assert.equal(response.headers.get('cache-control'),'private, no-store');
  response=await fetch(url,{headers:{...headers,Range:'bytes=1-3'}});assert.equal(response.status,206);assert.equal(response.headers.get('content-range'),'bytes 1-3/'+png.length);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()),png.subarray(1,4));
  response=await fetch(url,{headers:{...headers,Range:'bytes=999-'}});assert.equal(response.status,416);
  response=await fetch(url+'/metadata',{headers});const info=await response.json();assert.equal(info.originalName,'ação.png');assert.equal(JSON.stringify(info).includes('.bin'),false);
  const other=f.seedConversation();assert.equal((await fetch(url.replace(f.conversation.id,other.id),{headers})).status,404);
  const missing=f.state.get(Media)[0];missing.availability='failed';assert.equal((await fetch(url,{headers})).status,503);
  const history=await f.conversations.findMessages(f.conversation.id,{page:1,pageSize:50});assert.equal(history.items[0].media.availability,'failed');
});
