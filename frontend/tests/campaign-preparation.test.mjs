import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { webcrypto } from 'node:crypto';
const compiled=ts.transpileModule(fs.readFileSync('components/bulk-send/campaign-model.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
const api={};vm.runInNewContext(compiled,{exports:api,Intl,Date,crypto:webcrypto});
const row={names:['Ana real','Outro cadastro'],shopping:'Shopping real',storeName:'Loja real',group:'Grupo real',role:'Gerente'};
test('all five variables use recipient data without fabricated fallbacks',()=>{
  assert.equal(api.renderCampaignText('Olá {responsavel}, {shopping} / {loja} / {grupo} / {funcao}',row),'Olá Ana real / Outro cadastro, Shopping real / Loja real / Grupo real / Gerente');
  assert.equal(api.renderCampaignText('{loja}',{...row,storeName:null}),'[loja: não informado]');
  assert.equal(api.renderCampaignText('{desconhecida}',row),'[desconhecida: não informado]');
});
test('unknown, missing, malformed and duplicate variables are validated',()=>{
  assert.equal(api.usedVariables('{loja} {loja} {grupo}').length,2);
  assert.ok(api.validateMessage('Nome','{loja}',[{...row,storeName:null}]).some(e=>e.includes('sem loja')));
  assert.ok(api.validateMessage('Nome','{inexistente}',[row]).some(e=>e.includes('não reconhecida')));
  assert.ok(api.validateMessage('Nome','{{loja}}',[row]).some(e=>e.includes('uma chave')));
  assert.ok(api.validateMessage('Nome','{loja',[row]).some(e=>e.includes('incompletas')));
  assert.equal(api.validateMessage('Nome','Olá {responsavel}',[row]).length,0);
});
test('required name/message and preparation size limits',()=>{
  assert.ok(api.validateMessage('','',[]).length>=2);
  assert.ok(api.validateMessage('a'.repeat(121),'ok',[]).some(e=>e.includes('120')));
  assert.ok(api.validateMessage('Nome','a'.repeat(10001),[]).some(e=>e.includes('10.000')));
});
test('attachment extension, MIME, empty file, size, duplicates and count',()=>{
  const file={name:'aviso.pdf',size:1024,type:'application/pdf'};
  assert.equal(api.attachmentIssue(file,[]),null);
  assert.ok(api.attachmentIssue({...file,name:'aviso.exe'},[]));
  assert.ok(api.attachmentIssue({...file,type:'image/png'},[]));
  assert.ok(api.attachmentIssue({...file,size:0},[]));
  assert.ok(api.attachmentIssue({...file,size:16*1024*1024+1},[]));
  assert.ok(api.attachmentIssue(file,[file]));
  assert.ok(api.attachmentIssue(file,Array.from({length:10},(_,i)=>({...file,name:i+'.pdf'}))));
  assert.equal(api.attachmentIssue({...file,type:''},[]),null);
});
test('schedule validates numeric bounds, days, window and controlled retries',()=>{
  const s=api.defaultSchedule();assert.equal(api.validateSchedule(s).length,0);
  for(const bad of [{dailyLimit:0},{dailyLimit:1.5},{intervalSeconds:NaN},{days:[]},{days:[1,1]},{startTime:'18:00',endTime:'09:00'},{timeZone:'invalid'},{retryEnabled:true,maxRetries:4},{retryEnabled:true,retryAfterMinutes:0}])assert.ok(api.validateSchedule({...s,...bad}).length>0,JSON.stringify(bad));
});
test('schedule uses chosen timezone and rejects past/date/day/window inconsistencies',()=>{
  const s={...api.defaultSchedule(),mode:'scheduled',date:'2026-11-02',time:'09:00'};
  assert.equal(api.validateSchedule(s,new Date('2026-11-02T11:59:00Z')).length,0);
  assert.ok(api.validateSchedule(s,new Date('2026-11-02T12:01:00Z')).some(e=>e.includes('futuro')));
  assert.equal(api.validateSchedule({...s,timeZone:'America/Manaus'},new Date('2026-11-02T12:30:00Z')).length,0);
  for(const patch of [{date:'2026-11-01'},{date:'2026-02-30'},{time:'22:00'},{date:''}])assert.ok(api.validateSchedule({...s,...patch},new Date('2026-01-01T00:00:00Z')).length);
});
function storage(){const map=new Map();return {getItem:key=>map.get(key)??null,setItem:(key,value)=>map.set(key,value),map};}
function draft(){return {id:'draft',name:'Campanha',text:'Olá {loja}',updatedAt:'2026-10-28T12:00:00Z',selectionId:'selection',revisionId:'revision',schedule:api.defaultSchedule(),attachments:[{id:'file',name:'aviso.pdf',size:100,type:'application/pdf',file:{contents:'must never persist'}}]};}
test('explicit local saves isolate users and never persist files, contacts or auth',()=>{
  const store=storage();api.writeLibrary(store,'alice',{version:1,drafts:[draft()],templates:[]});
  assert.equal(api.readLibrary(store,'alice').drafts[0].selectionId,'selection');
  assert.equal(api.readLibrary(store,'bob').drafts.length,0);
  const raw=[...store.map.values()][0];assert.ok(!raw.includes('must never persist'));assert.ok(!raw.includes('contents'));assert.equal(api.readLibrary(store,'alice').drafts[0].attachments[0].file,undefined);
  assert.match(api.LOCAL_STORAGE_NOTICE,/Não são compartilhados/);
});
test('corrupt or incompatible library fails without overwriting saved data',()=>{
  const store=storage();store.setItem('whatsgestor.campaign-preparation.v1.a','{broken');assert.throws(()=>api.readLibrary(store,'a'));assert.equal([...store.map.values()][0],'{broken');
  store.setItem('whatsgestor.campaign-preparation.v1.a',JSON.stringify({version:1,drafts:[{...draft(),schedule:{}}],templates:[]}));assert.throws(()=>api.readLibrary(store,'a'));
});
test('blocked browser storage surfaces failure to caller',()=>{
  assert.throws(()=>api.readLibrary({getItem(){throw Error('blocked')}},'a'));
  assert.throws(()=>api.writeLibrary({setItem(){throw Error('full')}},'a',api.emptyLibrary()));
});
test('empty library has no invented templates or campaign records',()=>{const empty=api.emptyLibrary();assert.equal(empty.drafts.length,0);assert.equal(empty.templates.length,0);});
test('campaign components contain no send client or execution endpoint',()=>{
  for(const name of fs.readdirSync('components/bulk-send').filter(n=>/\.(tsx?|css)$/.test(n))){const source=fs.readFileSync('components/bulk-send/'+name,'utf8');assert.doesNotMatch(source,/from\s+['"][^'"]*(?:whatsapp-integration|whatsapp-conversations|whatsapp-connections|outbound|messages)['"]/i);assert.doesNotMatch(source,/fetch\s*\(|new\s+WebSocket|\/messages\b|\/connect\b/);}
  assert.match(fs.readFileSync('components/bulk-send/campaign-review.tsx','utf8'),/disabled>Iniciar campanha/);
});
