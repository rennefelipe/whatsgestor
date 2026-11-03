const {test}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {Logger}=require('@nestjs/common');Logger.overrideLogger(false);
const {conversationsFixture,Conversation,Message}=require('./helpers/conversations-fixture.cjs');
const {BaileysOutboundAdapter}=require('../dist/whatsapp-integration/outbound-adapter');
const {ConnectionManager}=require('../dist/whatsapp-integration/connection-manager');
const {cloneState}=require('../dist/whatsapp-integration/state-codec');
class Store{values=new Map();async get(ns,key){return cloneState(this.values.get(ns+'|'+key)??null);}async put(ns,key,value){this.values.set(ns+'|'+key,cloneState(value));}async entries(ns){return [...this.values].filter(([key])=>key.startsWith(ns+'|')).map(([key,value])=>({key:key.slice(ns.length+1),value:cloneState(value)}));}}
async function fixture(t,allowed=true){
 const f=await conversationsFixture(t,true,{STAGE6_INTEGRATION:true,WHATSAPP_INTEGRATION_ENABLED:true,WHATSAPP_INTEGRATION_ALLOW_SEND:allowed});
 const row=f.state.get(Conversation)[0];Object.assign(row,{remoteJid:'123@lid',attendanceStatus:'in_progress',assignedUserId:f.admin.id});
 const adapter=f.app.get(BaileysOutboundAdapter),manager=f.app.get(ConnectionManager),store=new Store();adapter.store=store;
 let calls=0;const socket={reserveMessageId:()=>randomUUID(),async send(jid,payload,id){calls++;return {key:{id,remoteJid:jid,fromMe:true},messageTimestamp:Math.floor(Date.now()/1000)};}};
 manager.readySocket=()=>socket;const bearer=await f.token(f.admin),url=(await f.app.getUrl())+'/whatsapp-conversations/'+row.id+'/messages';
 const send=async(key,body={textContent:'PRIVATE_TEST_TEXT'})=>{const r=await fetch(url,{method:'POST',headers:{Authorization:'Bearer '+bearer,'Content-Type':'application/json',...(key?{'Idempotency-Key':key}:{})},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};};
 return {...f,adapter,manager,store,socket,bearer,url,send,row,get calls(){return calls;}};
}
test('authorized HTTP text uses UUID, confirms and persists once under concurrent retries',async t=>{
 const f=await fixture(t),key=randomUUID();assert.equal((await f.send()).status,400);
 const [a,b]=await Promise.all([f.send(key),f.send(key)]);assert.equal(a.status,201);assert.equal(b.status,201);assert.equal(a.body.id,b.body.id);assert.equal(f.calls,1);assert.equal(f.state.get(Message).length,1);
 assert.equal((await f.store.entries('outbox'))[0].value.state,'persisted');
});
test('policy denial and disconnected socket have explicit pre-dispatch errors; pending read works while disabled',async t=>{
 const f=await fixture(t,false),result=await f.send(randomUUID());assert.equal(result.status,403);assert.equal(result.body.code,'MESSAGE_SEND_DISABLED');assert.equal(result.body.dispatchAttempted,false);assert.equal(f.calls,0);assert.equal(f.store.values.size,0);
 const pending=await f.call('/whatsapp-conversations/'+f.row.id+'/messages/attachments/pending',{bearer:f.bearer});assert.equal(pending.status,200);assert.equal(pending.body,null);
 const g=await fixture(t);g.manager.readySocket=()=>{throw Error('offline');};const unavailable=await g.send(randomUUID());assert.equal(unavailable.status,503);assert.equal(unavailable.body.dispatchAttempted,false);assert.equal(g.calls,0);
});
test('uncertain provider result is preserved and never resent; confirmed SQL failure only repeats persistence',async t=>{
 const f=await fixture(t);let calls=0;f.socket.send=async()=>{calls++;throw Error('unknown transport outcome');};const key=randomUUID();assert.equal((await f.send(key)).body.code,'SEND_CONFIRMATION_UNCERTAIN');assert.equal((await f.send(key)).status,409);assert.equal(calls,1);assert.equal(f.state.get(Message).length,0);
 const g=await fixture(t),id=randomUUID();g.faults.set(Message,Error('SQL fixture failure'));assert.equal((await g.send(id)).status,500);assert.equal((await g.store.entries('outbox'))[0].value.state,'confirmed');g.faults.delete(Message);assert.equal((await g.send(id)).status,201);assert.equal(g.calls,1);assert.equal(g.state.get(Message).length,1);
});
test('pending attachments expose safe status without credentials; review preserves uncertain evidence and cannot resend it',async t=>{
 const f=await fixture(t,false),id=randomUUID(),key=f.connectionId+'|'+f.row.id+'|'+id;
 const value={owner:f.admin.id,connectionId:f.connectionId,conversationId:f.row.id,remoteJid:'123@lid',state:'uncertain',digest:'SECRET_DIGEST',reservedId:'SECRET_PROVIDER_ID',file:{key:'SECRET_STORAGE_KEY',metadata:{kind:'image',originalName:'fixture.png'}}};await f.store.put('outbox',key,value);
 const route='/whatsapp-conversations/'+f.row.id+'/messages/attachments';const pending=await f.call(route+'/pending',{bearer:f.bearer});assert.equal(pending.status,200);assert.equal(pending.body.id,id);assert.equal(pending.body.state,'uncertain');assert.doesNotMatch(JSON.stringify(pending.body),/SECRET|@lid/);
 const result=await f.call(route+'/'+id+'/review',{bearer:f.bearer,method:'POST'});assert.equal(result.status,201);assert.equal(result.body.state,'reviewed');assert.equal((await f.store.get('outbox',key)).state,'uncertain');assert.equal((await f.call(route+'/pending',{bearer:f.bearer})).body,null);assert.equal(f.calls,0);
 assert.equal((await f.call(route+'/'+id)).status,401);const regular=await f.token(f.regular);assert.equal((await f.call(route+'/'+id+'/review',{bearer:regular,method:'POST'})).status,403);
});
