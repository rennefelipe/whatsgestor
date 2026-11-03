import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import ts from 'typescript';import {webcrypto} from 'node:crypto';
function load(file,globals={}){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:1,target:9}}).outputText,{exports,...globals});return exports;}
test('text retry uses the same UUID across remount/reload without storing plaintext; success permits a new intentional send',async()=>{
 const stored=new Map(),sessionStorage={getItem:k=>stored.get(k)??null,setItem:(k,v)=>stored.set(k,v),removeItem:k=>stored.delete(k)};
 const create=()=>load('components/whatsapp/text-send-attempt.ts',{crypto:webcrypto,TextEncoder,sessionStorage,require:()=>({createAttachmentAttemptId:()=>webcrypto.randomUUID()})});
 const a=create(),first=await a.textAttemptKey('chat','PRIVATE_TEXT');assert.equal(await a.textAttemptKey('chat','PRIVATE_TEXT'),first);assert.equal(await create().textAttemptKey('chat','PRIVATE_TEXT'),first);assert.doesNotMatch(JSON.stringify([...stored.values()]),/PRIVATE_TEXT/);
 a.clearTextAttempt('chat');assert.notEqual(await a.textAttemptKey('chat','PRIVATE_TEXT'),first);
});
test('API adapter sends the idempotency UUID in its header',async()=>{
 let request;const api=load('services/api/whatsapp-conversations.ts',{URLSearchParams,require:()=>({apiRequest:(...args)=>request=args})});api.sendWhatsappText('chat',{textContent:'fixture'},'same-key');assert.equal(request[1].headers['Idempotency-Key'],'same-key');
});
test('policy/disconnected errors retain explicit non-dispatch metadata; network failures remain uncertain',async()=>{
 const api=load('services/api/client.ts',{process:{env:{}},fetch:async()=>({ok:false,status:403,text:async()=>JSON.stringify({code:'MESSAGE_SEND_DISABLED',dispatchAttempted:false,message:'Envio desabilitado.'})}),require:()=>({getAccessToken:()=>'',notifyAuthenticationExpired(){}})});
 await assert.rejects(api.apiRequest('/messages'),e=>e.code==='MESSAGE_SEND_DISABLED'&&e.dispatchAttempted===false&&e.status===403);
 const offline=load('services/api/client.ts',{process:{env:{}},fetch:async()=>{throw Error('network');},require:()=>({getAccessToken:()=>'',notifyAuthenticationExpired(){}})});
 await assert.rejects(offline.apiRequest('/messages'),e=>e.status===0&&e.dispatchAttempted===undefined);
});
