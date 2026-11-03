const {test}=require('node:test'),assert=require('node:assert/strict');
const {loadBaileys,validateRc14Contract}=require('../dist/whatsapp-integration/baileys-socket.factory');
let installed=false;try{require.resolve('@whiskeysockets/baileys');installed=true;}catch{}
const unavailable=installed?false:'PENDENTE: instalar @whiskeysockets/baileys@7.0.0-rc14 com autorizacao. Nao inicia socket.';
test('installed rc14 import and exported API contract, without makeWASocket',{skip:unavailable},async()=>{
  const sdk=await loadBaileys();validateRc14Contract(sdk);
});
test('installed rc14 BufferJSON and auth categories preserve real protobuf/Signal buffers',{skip:unavailable},async()=>{
  const sdk=await loadBaileys(),creds=sdk.initAuthCreds(),input={creds,'lid-mapping':'123@lid','device-list':['0'],tctoken:{token:Buffer.from([0,255])}};
  const restored=JSON.parse(JSON.stringify(input,sdk.BufferJSON.replacer),sdk.BufferJSON.reviver);
  assert.deepEqual(restored.creds.noiseKey.private,creds.noiseKey.private);assert.deepEqual(restored.tctoken.token,Buffer.from([0,255]));
  const value=(sdk.proto.Message.AppStateSyncKeyData.fromObject??sdk.proto.Message.AppStateSyncKeyData.create)({keyData:Buffer.alloc(32)});assert.equal(value.keyData.length,32);
});
test('installed rc14 media HKDF contract and mixed event types, without network',{skip:unavailable},async()=>{
  const sdk=await loadBaileys();for(const type of ['image','audio','video','document']){const keys=await sdk.getMediaKeys(Buffer.alloc(32),type);assert.equal(keys.iv.length,16);assert.equal(keys.cipherKey.length,32);assert.equal(keys.macKey.length,32);}
  assert.equal(typeof sdk.makeEventBuffer,'function');const logger={trace(){},debug(){},info(){},warn(){},error(){},child(){return this;}},ev=sdk.makeEventBuffer(logger),observed=[];
  ev.on('messages.upsert',batch=>observed.push(batch.type));ev.buffer();
  ev.emit('messages.upsert',{type:'append',messages:[{key:{id:'old',remoteJid:'123@lid',fromMe:false},message:{conversation:'fixture'}}]});
  ev.emit('messages.upsert',{type:'notify',messages:[{key:{id:'new',remoteJid:'123@lid',fromMe:false},message:{conversation:'fixture'}}]});ev.flush();
  assert.deepEqual(observed,['append','notify']);
});
