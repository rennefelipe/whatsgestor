const {test}=require('node:test'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process'),{randomUUID}=require('node:crypto');
const {BaileysOutboundAdapter}=require('../dist/whatsapp-integration/outbound-adapter');
const {FilePolicy}=require('../dist/messages/file-policy');
const {ConfigService}=require('@nestjs/config');

test('browser WebM converts through protected adapter to OGG/Opus PTT and retries do not resend',async()=>{
 // Synthetic silence only. No SQL, filesystem state, network or WhatsApp socket.
 const webm=execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','anullsrc=r=48000:cl=mono','-t','0.2','-c:a','libopus','-f','webm','pipe:1'],{windowsHide:true,timeout:15000});
 const values=new Map();let saved,payload,sends=0;
 const conversation={id:randomUUID(),connectionId:randomUUID(),remoteJid:'123@lid'};
 const actor={id:randomUUID(),isAdmin:true,isActive:true};
 const socket={reserveMessageId:()=>randomUUID(),send:async(jid,body,id)=>{sends++;payload=body;return {key:{id,remoteJid:jid,fromMe:true},messageTimestamp:1};}};
 const adapter=new BaileysOutboundAdapter({readySocket:()=>socket},{enabled:true,allowSending:true,sendTimeoutMs:5000},
  {get:async(ns,key)=>structuredClone(values.get(ns+key)??null),put:async(ns,key,value)=>values.set(ns+key,structuredClone(value))},
  {authorizePreparation:async()=>{},ingest:async()=>({message:{id:'persisted-mock'}})},
  {findOne:async()=>conversation},
  {save:async bytes=>{saved=bytes;return {key:'mock-key'};},open:async()=>({handle:{readFile:async()=>saved,close:async()=>{}}})},
  new FilePolicy(new ConfigService()),{emit:()=>{}});
 const request={conversationId:conversation.id,actor,key:randomUUID(),file:{content:webm,metadata:{kind:'audio',mimeType:'audio/webm',originalName:'silence.webm'}}};
 await adapter.send(request);await adapter.send(request);
 assert.equal(sends,1);assert.equal(payload.mimetype,'audio/ogg; codecs=opus');assert.equal(payload.ptt,true);
 assert.equal(payload.audio.subarray(0,4).toString(),'OggS');assert.ok(payload.audio.includes(Buffer.from('OpusHead')));
 assert.equal([...values.values()][0].state,'persisted');
});
