// Isolated React UI + real API adapter. Never contacts SQL or WhatsApp.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
const require=createRequire(import.meta.url),root=process.cwd();
const {webpack}=require('next/dist/compiled/webpack/webpack');
const WebSocket=require('../../backend/node_modules/ws');
const work=fs.mkdtempSync(path.join(os.tmpdir(),'wg-pairing-ui-')),profile=path.join(work,'profile');
fs.mkdirSync(profile);
const write=(name,content)=>fs.writeFileSync(path.join(work,name),content);
write('loader.cjs',`module.exports=function(source){return require(${JSON.stringify(require.resolve('typescript'))}).transpileModule(source,{compilerOptions:{jsx:4,target:7,module:99}}).outputText;};`);
write('auth.ts','export const useAuth=()=>({user:{id:"qa-admin",isAdmin:true}});');
write('image.tsx','export default function Image({unoptimized,...props}){return <img {...props}/>;}');
write('api.ts',`
export class ApiRequestError extends Error{}
const id='00000000-0000-4000-8000-000000000001';
window.qaCalls=[];window.qaConfirm=false;window.qaQr=null;
window.qaState={id,name:'Homologação simulada',isActive:true,status:'disconnected',authenticationIssue:null,requiresPairingRecovery:false};
const timeout=window.setTimeout.bind(window),interval=window.setInterval.bind(window);
window.setTimeout=(fn,ms,...args)=>timeout(fn,ms===2500?30:ms,...args);
window.setInterval=(fn,ms,...args)=>interval(fn,ms===8000?80:ms,...args);
window.confirm=()=>window.qaConfirm;
export async function apiRequest(url,options={}){
 window.qaCalls.push({url,...options});
 if(url.endsWith('/storage-retry')){window.qaState={...window.qaState,status:'connecting',authenticationIssue:null,requiresPairingRecovery:false};return {...window.qaState};}
 if(url.endsWith('/pairing-recovery')){window.qaState={...window.qaState,status:'disconnected',authenticationIssue:null,requiresPairingRecovery:false};return {...window.qaState};}
 if(url.endsWith('/connect')){window.qaState={...window.qaState,status:'connecting'};return {...window.qaState};}
 if(url.endsWith('/disconnect')){window.qaState={...window.qaState,status:'disconnected'};return {...window.qaState};}
 if(url.endsWith('/qr'))return {qrCodeDataUrl:window.qaQr,expiresAt:window.qaQr?new Date(Date.now()+20000).toISOString():null};
 if(url.endsWith('/status'))return {...window.qaState};
 return [{...window.qaState}];
}`);
write('entry.tsx',`import React from 'react';import {createRoot} from 'react-dom/client';import {WhatsappConnectionsScreen} from ${JSON.stringify(path.join(root,'components/whatsapp/whatsapp-connections-screen.tsx'))};createRoot(document.getElementById('root')).render(<WhatsappConnectionsScreen isVisible/>);`);
let chrome,socket;
const pause=ms=>new Promise(r=>setTimeout(r,ms));
try{
 await new Promise((resolve,reject)=>webpack({mode:'development',devtool:false,entry:path.join(work,'entry.tsx'),output:{path:work,filename:'bundle.js'},
  resolve:{extensions:['.tsx','.ts','.js'],modules:[path.join(root,'node_modules'),'node_modules'],alias:{'@':root}},
  module:{rules:[{test:/\.tsx?$/,use:path.join(work,'loader.cjs')}]},plugins:[
   new webpack.NormalModuleReplacementPlugin(/auth-provider$/,path.join(work,'auth.ts')),
   new webpack.NormalModuleReplacementPlugin(/(?:services[\\/]api[\\/]client|\.\/client)(?:\.ts)?$/,path.join(work,'api.ts')),
   new webpack.NormalModuleReplacementPlugin(/^next\/image$/,path.join(work,'image.tsx')),
  ]},(error,stats)=>error||stats.hasErrors()?reject(error??Error(stats.toString({all:false,errors:true}))):resolve()));
 const css=fs.readFileSync(path.join(root,'app/globals.css'),'utf8').replace('@import "tailwindcss";','')+fs.readFileSync(path.join(root,'app/themes.css'),'utf8');
 write('index.html',`<!doctype html><html data-theme="white"><meta charset="utf-8"><style>${css}</style><div id="root"></div><script src="bundle.js"></script></html>`);
 chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{windowsHide:true,stdio:'ignore'});
 const portFile=path.join(profile,'DevToolsActivePort');for(let i=0;i<100&&!fs.existsSync(portFile);i++)await pause(100);
 const port=fs.readFileSync(portFile,'utf8').split('\n')[0],tabs=await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
 socket=new WebSocket(tabs.find(tab=>tab.type==='page').webSocketDebuggerUrl);await new Promise(r=>socket.once('open',r));
 let next=0;const pending=new Map();
 socket.on('message',raw=>{const event=JSON.parse(raw);if(!event.id)return;const item=pending.get(event.id);if(!item)return;pending.delete(event.id);event.error?item.reject(Error(event.error.message)):item.resolve(event.result);});
 const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++next,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method));},15000);pending.set(id,{resolve:v=>{clearTimeout(timer);resolve(v);},reject:e=>{clearTimeout(timer);reject(e);}});socket.send(JSON.stringify({id,method,params}));});
 const evaluate=async expression=>{const result=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result.value;};
 const wait=async expression=>{for(let i=0;i<160;i++){if(await evaluate(`Boolean(${expression})`))return;await pause(50);}throw Error('UI timeout: '+expression+'\n'+await evaluate('document.body.innerText'));};
 const click=async text=>{await evaluate(`Array.from(document.querySelectorAll('button')).find(button=>button.textContent.trim()===${JSON.stringify(text)}).click()`);await pause(80);};
 await send('Page.enable');await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 await send('Page.navigate',{url:pathToFileURL(path.join(work,'index.html')).href});await wait('document.body.innerText.includes("Homologação simulada")');
 await click('Conectar');await wait('window.qaCalls.some(call=>call.url.endsWith("/qr"))');
 assert.equal(await evaluate('document.body.innerText.includes("formato inválido")'),false);
 await evaluate(`window.qaQr='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=';window.qaState.status='qr_ready'`);
 await wait('document.querySelector(".whatsapp-qr-image")');
 await evaluate('window.qaState.status="reconnecting";window.qaQr=null');
 await wait('document.body.innerText.includes("Restabelecendo conexão")');assert.equal(await evaluate('!!document.querySelector(".whatsapp-qr-image")'),false);
 assert.equal(await evaluate('document.body.innerText.includes("formato inválido")'),false);
 await evaluate('window.qaState.status="connected"');await wait('!document.querySelector(".whatsapp-qr-modal")');
 await evaluate('window.qaState={...window.qaState,status:"disconnected",authenticationIssue:"credentials_rejected",requiresPairingRecovery:true}');
 await wait('document.body.innerText.includes("Autorizar novo pareamento")');
 assert.equal(await evaluate('Array.from(document.querySelectorAll("button")).find(b=>b.textContent.trim()==="Conectar").disabled'),true);
 await click('Autorizar novo pareamento');assert.equal(await evaluate('window.qaCalls.filter(c=>c.url.endsWith("/pairing-recovery")).length'),0);
 await evaluate('window.qaConfirm=true');await click('Autorizar novo pareamento');
 await wait('window.qaCalls.some(c=>c.url.endsWith("/pairing-recovery"))');
 const recovery=await evaluate('window.qaCalls.find(c=>c.url.endsWith("/pairing-recovery"))');
 assert.equal(JSON.parse(recovery.body).acknowledgeCredentialReplacement,true);
 assert.equal(JSON.parse(recovery.body).confirmation,'00000000-0000-4000-8000-000000000001');
 await wait('!document.body.innerText.includes("Autorizar novo pareamento")');
 assert.equal(await evaluate('window.qaCalls.filter(c=>c.url.endsWith("/connect")).length'),1); // Recovery never starts a socket implicitly.
 await evaluate('window.qaState={...window.qaState,status:"error",authenticationIssue:"storage_failure",requiresPairingRecovery:false}');
 await wait('document.body.innerText.includes("Retomar sessão")');
 assert.equal(await evaluate('window.qaCalls.filter(c=>c.url.endsWith("/storage-retry")).length'),0);
 await click('Retomar sessão');await wait('window.qaCalls.some(c=>c.url.endsWith("/storage-retry"))');
 assert.equal(await evaluate('window.qaCalls.filter(c=>c.url.endsWith("/connect")).length'),1);
 assert.equal(await evaluate('window.qaCalls.filter(c=>c.url.endsWith("/pairing-recovery")).length'),1);
 assert.equal(await evaluate('window.qaCalls.find(c=>c.url.endsWith("/storage-retry")).method'),'POST');
 console.log('WhatsApp browser QA passed: pairing, 515, 401 and explicit storage retry with existing credentials.');
 await send('Browser.close');
}finally{
 socket?.close();chrome?.kill();await pause(500);
 assert.equal(path.dirname(work),path.resolve(os.tmpdir()));assert.ok(path.basename(work).startsWith('wg-pairing-ui-'));
 try{fs.rmSync(work,{recursive:true,force:true});}catch{/* Chrome may still be releasing its temporary profile. */}
}
