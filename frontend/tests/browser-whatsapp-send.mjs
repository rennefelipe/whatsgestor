// Real React + API adapters, isolated simulated API. Never connects to WhatsApp/SQL.
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import assert from 'node:assert/strict';
import {createRequire} from 'node:module';import {spawn} from 'node:child_process';import {pathToFileURL} from 'node:url';
const require=createRequire(import.meta.url),root=process.cwd(),{webpack}=require('next/dist/compiled/webpack/webpack'),WebSocket=require('../../backend/node_modules/ws');
const work=fs.mkdtempSync(path.join(os.tmpdir(),'wg-send-ui-')),profile=path.join(work,'profile');fs.mkdirSync(profile);
const write=(name,body)=>fs.writeFileSync(path.join(work,name),body);
write('loader.cjs',`module.exports=function(source){return require(${JSON.stringify(require.resolve('typescript'))}).transpileModule(source,{compilerOptions:{jsx:4,target:7,module:99}}).outputText;};`);
write('auth.ts','export const useAuth=()=>({user:{id:"qa-admin",isAdmin:true,isActive:true}});');
write('avatar.tsx','export function ProfileAvatar(){return <span/>;}');
write('api.ts',`
export class ApiRequestError extends Error{constructor(message,status,code,dispatchAttempted){super(message);Object.assign(this,{status,code,dispatchAttempted});}}
window.qaCalls=[];window.qaRows=[];window.qaMessages={};window.qaMode='policy';window.qaSendCalls=[];window.qaAccepted={};
window.qaConnection='00000000-0000-4000-8000-000000000001';window.qaOther='00000000-0000-4000-8000-000000000002';
const interval=window.setInterval.bind(window);window.setInterval=(fn,ms,...args)=>interval(fn,[5000,10000,30000].includes(ms)?100:ms,...args);
export async function apiBlob(){return new Blob([]);}
export async function apiRequest(route,options={}){
 if(options.method==='POST'&&route.endsWith('/messages')){
 const key=options.headers['Idempotency-Key'];window.qaSendCalls.push(key);
 if(window.qaMode==='policy')throw new ApiRequestError('Envio desabilitado pela política administrativa. Nenhuma mensagem foi enviada.',403,'MESSAGE_SEND_DISABLED',false);
 const conversationId=route.split('/')[2],message=window.qaAccepted[key]||{id:'sent-'+key,conversationId,fromMe:true,messageType:'text',textContent:JSON.parse(options.body).textContent,status:'sent',messageTimestamp:new Date().toISOString(),createdAt:new Date().toISOString()};
 window.qaAccepted[key]=message;window.qaMessages[conversationId]=[message];
 if(window.qaMode==='lost')throw new ApiRequestError('Falha de rede.',0);
 return message;
 }if(options.method&&options.method!=='GET')throw Error('Unexpected mutation');window.qaCalls.push(route);
 const url=new URL(route,'http://fixture'),conn=url.searchParams.get('connectionId');
 if(url.pathname==='/whatsapp-connections')return [{id:window.qaConnection,name:'Conexão simulada A',isActive:true,status:'connected',sendingEnabled:window.qaSendEnabled},{id:window.qaOther,name:'Conexão simulada B',isActive:true,status:'connected',sendingEnabled:window.qaSendEnabled}];
 if(url.pathname==='/users')return [];
 if(url.pathname==='/whatsapp-conversations'){const rows=window.qaRows.filter(r=>!conn||r.connectionId===conn);return {items:rows,total:rows.length,page:1,pageSize:50};}
 if(url.pathname.endsWith('/messages')){const id=url.pathname.split('/')[2],rows=window.qaMessages[id]||[];return {items:rows,total:rows.length,page:1,pageSize:50};}
 if(url.pathname.endsWith('/capabilities'))return {enabled:false,attachmentsEnabled:false,audioEnabled:false};
 return null;
}`);
write('entry.tsx',`import React from 'react';import {createRoot} from 'react-dom/client';import {WhatsappConversationsScreen} from ${JSON.stringify(path.join(root,'components/whatsapp/whatsapp-conversations-screen.tsx'))};createRoot(document.getElementById('root')).render(<WhatsappConversationsScreen isVisible/>);`);
let chrome,socket;const pause=ms=>new Promise(r=>setTimeout(r,ms));
try{
 await new Promise((resolve,reject)=>webpack({mode:'development',devtool:false,entry:path.join(work,'entry.tsx'),output:{path:work,filename:'bundle.js'},
 resolve:{extensions:['.tsx','.ts','.js'],modules:[path.join(root,'node_modules'),'node_modules'],alias:{'@':root}},module:{rules:[{test:/\.tsx?$/,use:path.join(work,'loader.cjs')}]},
 plugins:[new webpack.NormalModuleReplacementPlugin(/auth-provider$/,path.join(work,'auth.ts')),new webpack.NormalModuleReplacementPlugin(/(?:services[\\/]api[\\/]client|\.\/client)(?:\.ts)?$/,path.join(work,'api.ts')),new webpack.NormalModuleReplacementPlugin(/profile-avatar$/,path.join(work,'avatar.tsx'))]},
 (error,stats)=>error||stats.hasErrors()?reject(error??Error(stats.toString({all:false,errors:true}))):resolve()));
 const css=fs.readFileSync(path.join(root,'app/globals.css'),'utf8').replace('@import "tailwindcss";','')+fs.readFileSync(path.join(root,'app/themes.css'),'utf8');
 write('index.html',`<!doctype html><html data-theme="white"><meta charset="utf-8"><style>${css}</style><div id="root"></div><script src="bundle.js"></script></html>`);
 chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{windowsHide:true,stdio:'ignore'});
 const portFile=path.join(profile,'DevToolsActivePort');for(let i=0;i<100&&!fs.existsSync(portFile);i++)await pause(100);
 const port=fs.readFileSync(portFile,'utf8').split('\n')[0],tabs=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();
 socket=new WebSocket(tabs.find(tab=>tab.type==='page').webSocketDebuggerUrl);await new Promise(r=>socket.once('open',r));let next=0;const pending=new Map();
 socket.on('message',raw=>{const event=JSON.parse(raw);if(!event.id)return;const item=pending.get(event.id);if(!item)return;pending.delete(event.id);event.error?item.reject(Error(event.error.message)):item.resolve(event.result);});
 const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++next,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method));},15000);pending.set(id,{resolve:v=>{clearTimeout(timer);resolve(v);},reject:e=>{clearTimeout(timer);reject(e);}});socket.send(JSON.stringify({id,method,params}));});
 const evaluate=async expression=>{const result=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result.value;};
 const wait=async expression=>{for(let i=0;i<160;i++){if(await evaluate(`Boolean(${expression})`))return;await pause(50);}throw Error('UI timeout '+expression+'\n'+await evaluate('document.body.innerText'));};
 const click=async label=>{await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim().startsWith(${JSON.stringify(label)})).click()`);await pause(100);};
 await send('Page.enable');await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});await send('Page.navigate',{url:pathToFileURL(path.join(work,'index.html')).href});
 await wait('window.qaCalls?.some(p=>p.startsWith("/whatsapp-conversations"))');

 await evaluate(`window.qaRows=[{id:'chat-a',connectionId:qaConnection,remoteJid:'123@lid',contactName:'Contato simulado',contact:null,contactId:null,attendanceStatus:'in_progress',assignedUserId:'qa-admin',assignedUser:null,lastMessageAt:null,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}]`);
 await wait('document.querySelector(".conversation-item")');await click('Em atendimento');await evaluate(`document.querySelector('.conversation-item').click()`);
 await wait('document.querySelector("textarea")&&!document.querySelector("textarea").disabled');
 await evaluate(`const field=document.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(field,'Texto de teste simulado');field.dispatchEvent(new Event('input',{bubbles:true}));`);
 await pause(150);await evaluate(`document.querySelector('.conversation-composer').requestSubmit()`);
 await wait('document.body.innerText.includes("Envio desabilitado pela política")');
 assert.equal(await evaluate('document.body.innerText.includes("O envio pode ter sido aceito")'),false);
 assert.equal(await evaluate('document.body.innerText.includes("Não foi possível verificar envios pendentes")'),false);
 await evaluate(`window.qaMode='lost';document.querySelector('.conversation-composer').requestSubmit()`);
 await wait('document.body.innerText.includes("O envio pode ter sido aceito")');
 await evaluate(`window.qaMode='success';document.querySelector('.conversation-composer').requestSubmit()`);
 await wait('document.querySelector("textarea").value===""');
 assert.equal(await evaluate('Object.keys(window.qaAccepted).length'),1);
 assert.equal(await evaluate('window.qaSendCalls.length'),3);
 assert.equal(await evaluate('new Set(window.qaSendCalls).size'),1);
 await evaluate('window.qaSendEnabled=false');
 await wait('document.querySelector("textarea").disabled&&document.body.innerText.includes("Solicite autorização ao administrador")');
 console.log('Send browser QA passed: policy message without false acceptance warning, pending check, stable UUID on lost response and retry, one accepted message, disabled policy prevents dispatch. Simulated API only.');
 await send('Browser.close');
}finally{
 socket?.close();chrome?.kill();await pause(500);assert.equal(path.dirname(work),path.resolve(os.tmpdir()));assert.match(path.basename(work),/^wg-send-ui-/);try{fs.rmSync(work,{recursive:true,force:true});}catch{}
}
