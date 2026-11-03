import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import ts from 'typescript';
const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync('components/whatsapp/conversation-presentation.ts','utf8'),{compilerOptions:{module:1,target:7}}).outputText,{exports});
const message=(id,textContent,messageType='text',at='2026-10-26T13:30:00Z')=>({id,textContent,messageType,messageTimestamp:at,createdAt:at});
test('every list row uses its own latest message before selection, with media labels',()=>{
 for(const [kind,label]of [['image','Imagem'],['audio','Áudio'],['document','Documento']])assert.equal(exports.conversationPreview({lastMessage:message(kind,null,kind)},[]),label);
 assert.equal(exports.conversationPreview({lastMessage:message('one','Mensagem A')},[]),'Mensagem A');
 assert.equal(exports.conversationPreview({lastMessage:message('two','Mensagem B')},[]),'Mensagem B');
});
test('a newer polled message updates the preview before the next list poll; old history cannot replace latest',()=>{
 const conversation={lastMessage:message('one','Anterior'),lastMessageAt:'2026-10-26T13:30:00Z'};
 assert.equal(exports.conversationPreview(conversation,[message('two','Nova','text','2026-10-26T13:31:00Z')]),'Nova');
 assert.equal(exports.conversationPreview(conversation,[message('old','Histórico','text','2026-10-25T13:30:00Z')]),'Anterior');
});
