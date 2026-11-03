// Isolated Contacts QA: real components and API client, fixture transport, no database.
// Run from frontend: node tests/browser-contacts.mjs
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url);
const { webpack } = require("next/dist/compiled/webpack/webpack");
const WebSocket = require("../../backend/node_modules/ws");
const root = process.cwd();
const directory = path.join(root, ".next", "contacts-qa");
fs.mkdirSync(directory, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "whatsgestor-contacts-"));
const write = (name, content) =>
  fs.writeFileSync(path.join(directory, name), content);
write(
  "loader.cjs",
  `const ts=require(${JSON.stringify(path.join(root, "node_modules/typescript"))});module.exports=function(source){return ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2020}}).outputText;};`,
);
write(
  "auth.ts",
  `export const useAuth=()=>({user:{id:'qa',username:'Teste',isAdmin:window.qaAdmin!==false},logout:()=>{}});`,
);
write(
  "stubs.tsx",
  `export const AppearanceSettings=()=>null;export const SettingsContent=()=>null;export const WhatsappConnectionsScreen=()=>null;export const WhatsappConversationsScreen=()=>null;export const ProfileAvatar=()=>null;`,
);
write(
  "transport.ts",
  `
const group={id:'g',name:'ANCAR',organizationType:{name:'Grupo'},isActive:true};
const shopping={id:'s',name:'Shopping Paulista',organizationType:{name:'Shopping'},parentOrganizationId:'g',isActive:true};
const other={id:'o',name:'Outro shopping',organizationType:{name:'Shopping'},parentOrganizationId:'g',isActive:true};
const direct={id:'d',name:'Matriz',organizationType:{name:'Empresa'},isActive:true};
const orgs=[group,shopping,other,direct];group.organizationTypeId='og';shopping.organizationTypeId='os';other.organizationTypeId='os';direct.organizationTypeId='ot';
const automaticTemplates=[{id:'model-1',name:'Aguardando atendimento',event:'waiting',text:'Olá! Aguarde o atendimento.',isActive:false,version:1}];window.qaAutomaticTemplates=automaticTemplates;
const orgTypes=[{id:'og',name:'GRUPO',isActive:true},{id:'os',name:'SHOPPING',isActive:true},{id:'ot',name:'Empresa',isActive:true}];
for(const o of orgs){o.organizationTypeId=o.id==='g'?'og':o.id==='d'?'ot':'os';o.organizationType=orgTypes.find(t=>t.id===o.organizationTypeId);}
window.qaOrganizations=orgs;
const roles=[{id:'r1',name:'Lojista',isActive:false},{id:'r2',name:'TI',isActive:true},{id:'r3',name:'ADM',isActive:true}];
const contexts=orgs.map(o=>({organizationId:o.id,organizationType:o.organizationType.name,group:o.id==='d'?null:{id:'g',name:'ANCAR'},shopping:['s','o'].includes(o.id)?{id:o.id,name:o.name}:null,hierarchyIssue:null}));
const row=(id,name,org,role,store)=>({id,contactName:name,organizationId:org.id,organization:org,contactTypeId:role.id,contactType:role,storeName:store,phone:'  +55 (11) 99999-0000  ',email:null,isActive:true,organizationContext:contexts.find(c=>c.organizationId===org.id)});
const rows=[row('a','Natália',shopping,roles[0],'Americanas'),row('b','Natália',shopping,roles[1],'Americanas'),row('c','Natália',shopping,roles[2],null),row('d','Administrativo',direct,roles[2],null),...Array.from({length:27},(_,i)=>row('x'+i,'Pessoa '+i,other,roles[1],'Loja '+i))];
window.qaRequests=[];window.qaRows=rows;
const preferences=[{id:'pref-global',normalizedPhone:'+5511999990000',shoppingId:null,isActive:true,version:1,reason:'Solicitacao do responsavel',createdAt:'2026-10-15T12:00:00Z',revokedAt:null},{id:'pref-shopping',normalizedPhone:'+5511999990000',shoppingId:'s',isActive:true,version:1,reason:'Preferencia registrada no shopping',createdAt:'2026-10-15T12:01:00Z',revokedAt:null}];
const events=preferences.map(p=>({id:'event-'+p.id,preferenceId:p.id,action:'block',reason:p.reason,actorUsername:'admin',createdAt:p.createdAt,beforeState:null,afterState:JSON.stringify(p)}));
window.qaPreferences=preferences;window.qaEvents=events;

export class ApiRequestError extends Error {constructor(message,status,code){super(message);this.status=status;this.code=code;}}
export async function apiBlob(){return new Blob();}
export async function apiRequest(url,init={}){
 const parsedBody=init.body instanceof FormData?JSON.parse(await init.body.get('payload').text()):init.body?JSON.parse(init.body):null;
 window.qaRequests.push({url,method:init.method||'GET',body:parsedBody});
 const [pathname,query]=url.split('?'); const p=new URLSearchParams(query);
 if(pathname==='/data-exchange/options')return {standaloneTypes:[{id:'ot',name:'Empresa'}],organizations:orgs};
 if(pathname==='/data-exchange/export')return {rows:[{Grupo:'ANCAR','Organização / Shopping':'Shopping Paulista',Loja:'Americanas','Responsável':'Natália',WhatsApp:'11999990000','Tipo de contato':'Gerente','E-mail':'',Ativo:'Sim'}],warnings:[]};
 if(pathname==='/data-exchange/preview-file'){
   const data=parsedBody,errors=data.rows.filter(row=>row['E-mail']==='invalid').length;
   const summary={newRecords:4,existingContacts:0,updatedContacts:0,newContacts:1,newGroups:1,newShoppings:1,newOrganizations:0,updatedOrganizations:0,existingOrganizations:0,newContactTypes:1,newOrganizationTypes:0,errorLines:errors,emptyLines:0};
   window.qaImportPreview={id:'preview-1',expiresAt:Date.now()+900000,canConfirm:!errors,summary,rows:data.rows.map((values,index)=>({row:index+2,values,action:values['E-mail']==='invalid'?'error':'new',actions:['Criar grupo AD','Criar shopping Shopping Mogi','Criar tipo de contato Lojista','Criar contato José'],issues:values['E-mail']==='invalid'?['E-mail inválido.']:[]}))};return window.qaImportPreview;
 }
 if(pathname==='/data-exchange/preview-1/commit'){
   if(window.qaAdmin===false)throw new ApiRequestError('Somente administradores',403);
   window.qaImportCommits=(window.qaImportCommits||0)+1;return {state:'completed',summary:window.qaImportPreview.summary,rows:window.qaImportPreview.rows,imported:4,updated:0,existing:0};
 }
 if(pathname.startsWith('/automatic-messages')){
   if(init.method==='POST'){const dto=JSON.parse(init.body);const value={...dto,id:'model-'+(automaticTemplates.length+1),version:1};automaticTemplates.push(value);return value;}
   if(init.method==='PUT'){const id=pathname.split('/').at(-1),value=automaticTemplates.find(item=>item.id===id);Object.assign(value,JSON.parse(init.body),{version:value.version+1});return value;}
   if(init.method==='DELETE'){automaticTemplates.splice(automaticTemplates.findIndex(item=>item.id===pathname.split('/').at(-1)),1);return {deleted:true};}
   return {templates:automaticTemplates,dispatchEnabled:false,recentEvents:[]};
 }

 if(pathname.includes('/campaign-preferences')) {
  if(window.qaPreferenceFailure)throw Error('Preferencias indisponiveis');
  if(pathname.endsWith('/events'))return {items:events.filter(e=>e.preferenceId===pathname.split('/')[3]),total:events.filter(e=>e.preferenceId===pathname.split('/')[3]).length,page:1,pageSize:10};
  if(init.method==='POST') {
    if(window.qaAdmin===false)throw Error('Forbidden');
    const body=JSON.parse(init.body);
    if(pathname.endsWith('/revoke')){const pref=preferences.find(p=>p.id===pathname.split('/')[3]);if(!body.confirmed||body.version!==pref.version)throw Error('Conflict');const beforeState=JSON.stringify(pref);pref.isActive=false;pref.version++;pref.revokedAt=new Date().toISOString();events.push({id:'event-'+events.length,preferenceId:pref.id,action:'revoke',reason:body.reason,actorUsername:'admin',createdAt:pref.revokedAt,beforeState,afterState:JSON.stringify(pref)});return {...pref};}
    const pref={id:'pref-'+preferences.length,normalizedPhone:'+5511999990000',shoppingId:body.shoppingId,isActive:true,version:1,reason:body.reason,createdAt:new Date().toISOString(),revokedAt:null};preferences.push(pref);events.push({id:'event-'+events.length,preferenceId:pref.id,action:'block',reason:pref.reason,actorUsername:'admin',createdAt:pref.createdAt,afterState:JSON.stringify(pref)});return pref;
  }
  return {items:preferences,total:preferences.length,page:1,pageSize:10,normalizedPhone:'+5511999990000',affectedContacts:rows.length,identities:[]};
 }
 if(pathname==='/organization-types')return orgTypes;
 if(pathname==='/organizations')return orgs;
 if(pathname==='/contact-types')return roles;
 if(pathname==='/contact-display-settings')return ['group','shopping','store','contactType','contactName'].map((fieldKey,i)=>({id:fieldKey,fieldKey,isVisible:true,displayOrder:i+1}));
 if(pathname==='/contacts/options')return {organizationContexts:contexts,storeNames:['Americanas',...Array.from({length:27},(_,i)=>'Loja '+i)]};
 if(init.method==='PATCH'){const target=rows.find(r=>r.id===pathname.split('/')[2]);Object.assign(target,JSON.parse(init.body));return {...target};}
 if(init.method==='POST'){const data=JSON.parse(init.body);const contact=row('new'+rows.length,data.contactName,orgs.find(o=>o.id===data.organizationId)||direct,roles.find(r=>r.id===data.contactTypeId),data.storeName);Object.assign(contact,data);rows.push(contact);return contact;}
 if(pathname==='/contacts'){
  const result=rows.filter(r=>(!p.get('groupId')||r.organizationContext.group?.id===p.get('groupId'))&&(!p.get('shoppingId')||r.organizationContext.shopping?.id===p.get('shoppingId'))&&(!p.get('organizationId')||r.organizationId===p.get('organizationId'))&&(!p.get('contactTypeId')||r.contactTypeId===p.get('contactTypeId'))&&(!p.get('storeName')||r.storeName===p.get('storeName'))&&(p.get('withoutStore')!=='true'||!r.storeName)&&(!p.get('contactName')||r.contactName.includes(p.get('contactName')))&&(!p.get('phone')||r.phone.replace(/\\D/g,'').includes(p.get('phone').replace(/\\D/g,''))));
  const page=Number(p.get('page')||1),pageSize=Number(p.get('pageSize')||25);return p.has('page')?{items:result.slice((page-1)*pageSize,page*pageSize),total:result.length,page,pageSize}:result;
 }
 throw Error('Unexpected fixture request '+url);
}`,
);
write(
  "entry.tsx",
  `import React from 'react';import {createRoot} from 'react-dom/client';import {ContactsScreen} from ${JSON.stringify(path.join(root, "components/contacts/contacts-screen").replaceAll("\\", "/"))};createRoot(document.getElementById('root')).render(<ContactsScreen/>);`,
);
await new Promise((resolve, reject) =>
  webpack(
    {
      mode: "development",
      devtool: false,
      entry: path.join(directory, "entry.tsx"),
      output: { path: directory, filename: "bundle.js" },
      resolve: { extensions: [".tsx", ".ts", ".js"], alias: { "@": root } },
      module: {
        rules: [{ test: /\.tsx?$/, use: path.join(directory, "loader.cjs") }, { test: /\.css$/, type: "asset/source" }],
      },
      plugins: [
        new webpack.NormalModuleReplacementPlugin(
          /auth-provider$/,
          path.join(directory, "auth.ts"),
        ),
        new webpack.NormalModuleReplacementPlugin(
          /(?:appearance-settings|whatsapp-connections-screen|whatsapp-conversations-screen|profile-avatar)$/,
          path.join(directory, "stubs.tsx"),
        ),
        new webpack.NormalModuleReplacementPlugin(
          /(?:services[\\/]api[\\/]client|\.\/client)(?:\.ts)?$/,
          path.join(directory, "transport.ts"),
        ),
      ],
    },
    (error, stats) =>
      error || stats.hasErrors()
        ? reject(error || Error(stats.toString({ all: false, errors: true })))
        : resolve(),
  ),
);
const css =
  fs
    .readFileSync("app/globals.css", "utf8")
    .replace('@import "tailwindcss";', "") +
  fs.readFileSync("app/themes.css", "utf8") +
  ".sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}";
write(
  "index.html",
  `<!doctype html><html data-theme="white"><meta charset="utf-8"><style>${css}</style><div id="root"></div><script src="bundle.js"></script></html>`,
);
const chrome = spawn(
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--no-first-run",
    "--no-default-browser-check",
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    "about:blank",
  ],
  { windowsHide: true, stdio: "ignore" },
);
let socket;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
try {
  const portFile = path.join(profile, "DevToolsActivePort");
  let port;
  for (let i = 0; i < 100 && !port; i++) {
    try {
      const value = fs.readFileSync(portFile, "utf8").split("\n")[0];
      if (/^\d+$/.test(value)) port = value;
    } catch (error) {
      if (!["ENOENT", "EBUSY"].includes(error.code)) throw error;
    }
    if (!port) await pause(100);
  }
  assert.ok(port, "Chrome did not publish its debugging port");
  const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  socket = new WebSocket(
    tabs.find((tab) => tab.type === "page").webSocketDebuggerUrl,
  );
  await new Promise((resolve) => socket.once("open", resolve));
  let id = 0;
  const pending = new Map();
  socket.on("close", (code, reason) => {
    for (const entry of pending.values())
      entry.reject(Error(`Browser connection closed: ${code} ${reason}`));
    pending.clear();
  });
  socket.on("message", (raw) => {
    const message = JSON.parse(raw);
    if (message.id) {
      const entry = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) entry.reject(Error(message.error.message));
      else entry.resolve(message.result);
    }
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const next = ++id;
      const timer = setTimeout(() => {
        pending.delete(next);
        reject(Error(`Browser command timeout: ${method}`));
      }, 15000);
      pending.set(next, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      socket.send(JSON.stringify({ id: next, method, params }));
    });
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails)
      throw Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const wait = async (expression) => {
    for (let i = 0; i < 120; i++) {
      if (await evaluate(`Boolean(${expression})`)) return;
      await pause(50);
    }
    throw Error("Timeout: " + expression + "\n" + await evaluate("document.body.innerText.slice(-2500)"));
  };
  const change = async (selector, value) => {
    await evaluate(
      `(()=>{const element=document.querySelector(${JSON.stringify(selector)});const proto=element.tagName==='SELECT'?HTMLSelectElement.prototype:element.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(element,${JSON.stringify(value)});element.dispatchEvent(new Event(element.tagName==='SELECT'?'change':'input',{bubbles:true}));})()`,
    );
    await pause(400);
  };
  const click = async (selector) => {
    await evaluate(
      `document.querySelector(${JSON.stringify(selector)}).click()`,
    );
    await pause(100);
  };
  await send("Page.enable");
  await send("Page.navigate", {
    url: pathToFileURL(path.join(directory, "index.html")).href + "#contacts",
  });
  await wait("document.querySelectorAll('tbody tr').length===25");
  await click('[aria-controls="contacts-additional-filters"]');
  assert.equal(
    await evaluate(
      "document.querySelector('.results-summary').textContent.includes('31 contatos')",
    ),
    true,
  );
  await click('[aria-label="Paginação de contatos"] button:last-child');
  await wait("document.querySelectorAll('tbody tr').length===6");
  await change('[aria-label="Filtrar por grupo"]', "g");
  await change('[aria-label="Filtrar por shopping"]', "s");
  await wait("document.querySelectorAll('tbody tr').length===3");
  await change('input[placeholder="Nome do responsável"]', "Natália");
  await change('input[placeholder="Número de WhatsApp"]', "11999990000");
  await wait("document.querySelectorAll('tbody tr').length===3");
  assert.equal(
    await evaluate(
      "(()=>{const p=new URL(window.qaRequests.filter(r=>r.url.startsWith('/contacts?')).at(-1).url,'http://fixture').searchParams;return p.get('contactName')==='Natália'&&p.get('phone')==='11999990000'})()",
    ),
    true,
  );
  assert.equal(
    await evaluate(
      "[...document.querySelectorAll('tbody tr')].every(r=>r.textContent.includes('Natália'))",
    ),
    true,
  );
  await change('[aria-label="Filtrar por loja"]', "store:Americanas");
  await change('[aria-label="Filtrar por função ou cargo"]', "r2");
  await wait("document.querySelectorAll('tbody tr').length===1");
  assert.equal(
    await evaluate(
      "(()=>{const u=new URL(window.qaRequests.filter(r=>r.url.startsWith('/contacts?')).at(-1).url,'http://fixture');return ['groupId','shoppingId','storeName','contactTypeId'].every(k=>u.searchParams.has(k))&&u.searchParams.get('page')==='1'})()",
    ),
    true,
  );
  await change('[aria-label="Filtrar por função ou cargo"]', "");
  await change('[aria-label="Filtrar por loja"]', "none");
  await wait(
    "document.querySelectorAll('tbody tr').length===1 && document.querySelector('tbody').textContent.includes('ADM')",
  );
  assert.equal(
    await evaluate(
      "document.querySelector('tbody').textContent.includes('Sem loja')",
    ),
    true,
  );
  await change('[aria-label="Filtrar por loja"]', "");
  await click('[aria-label="Editar Natália"]');
  await wait(
    "document.querySelector('.organization-context-card')?.textContent.includes('Shopping Paulista')",
  );
  assert.equal(
    await evaluate("document.querySelector('.organization-context-card').textContent.includes('ANCAR')"),
    true,
  );
  assert.equal(
    await evaluate(
      "document.querySelector('#contactTypeId option:checked').textContent.includes('inativa')",
    ),
    true,
  );
  for (const width of [1440, 390]) {
    await send("Emulation.setDeviceMetricsOverride", {
      width,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await pause(100);
    const screenshot = await send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(
      path.join(directory, `form-${width}.png`),
      Buffer.from(screenshot.data, "base64"),
    );
  }
  await change("#contactName", "Natália Silva");
  await click('form button[type="submit"]');
  await wait(
    "window.qaRequests.some(r=>r.method==='PATCH') && !document.querySelector('[role=dialog]')",
  );
  assert.deepEqual(
    await evaluate("window.qaRequests.find(r=>r.method==='PATCH').body"),
    { contactName: "Natália Silva" },
  );
  assert.equal(
    await evaluate("window.qaRows[0].phone"),
    "  +55 (11) 99999-0000  ",
  );
  await click('[aria-label="Editar Natália Silva"]');
  await wait("document.querySelector('#contactName')?.value==='Natália Silva'");
  await click('form button[type="submit"]');
  await wait("!document.querySelector('[role=dialog]')");
  assert.equal(
    await evaluate("window.qaRequests.filter(r=>r.method==='PATCH').length"),
    1,
  );
  await click(".page-heading .primary-button");
  await wait("document.querySelector('#organizationId')");
  await change("#organizationId", "d");
  assert.equal(await evaluate("document.querySelector('.organization-context-card').textContent.includes('Matriz')"), true);
  assert.equal(await evaluate("document.querySelector('.organization-context-card').textContent.includes('Não informado')"), false);
  await change("#contactTypeId", "r3");
  await change("#contactName", "Administrativo novo");
  await change("#phone", "(11) 99999-0000");
  await click('form button[type="submit"]');
  await wait(
    "window.qaRequests.some(r=>r.method==='POST') && !document.querySelector('[role=dialog]')",
  );
  assert.equal(
    await evaluate(
      "window.qaRequests.find(r=>r.method==='POST').body.storeName",
    ),
    null,
  );
  await change('[aria-label="Filtrar por grupo"]', "");
  await change('input[placeholder="Nome do responsável"]', "");
  await change('input[placeholder="Número de WhatsApp"]', "");
  for (const theme of ["white", "gray", "dark"]) {
    for (const width of [1440, 768, 390]) {
      await send("Emulation.setDeviceMetricsOverride", {
        width,
        height: 1000,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await evaluate(
        `document.documentElement.dataset.theme=${JSON.stringify(theme)}`,
      );
      await pause(100);
      if (
        !(await evaluate("document.documentElement.scrollWidth <= innerWidth"))
      ) {
        console.error(
          await evaluate(
            "JSON.stringify({width:innerWidth,scroll:document.documentElement.scrollWidth,overflow:[...document.querySelectorAll('body *')].filter(e=>e.getBoundingClientRect().right>innerWidth+1).slice(0,12).map(e=>({tag:e.tagName,class:e.className,right:e.getBoundingClientRect().right}))})",
          ),
        );
      }
      assert.equal(
        await evaluate("document.documentElement.scrollWidth <= innerWidth"),
        true,
        `${theme}/${width} overflow`,
      );
      const shot = await send("Page.captureScreenshot", {
        format: "png",
        captureBeyondViewport: true,
      });
      fs.writeFileSync(
        path.join(directory, `${theme}-${width}.png`),
        Buffer.from(shot.data, "base64"),
      );
    }
  }
  // Permanent preferences are managed only in Contacts; fixture transport only.
  await click('[title="Restrições de envio"]');
  await wait("document.querySelector('#campaign-reason')");
  assert.equal(await evaluate("document.querySelector('[role=dialog]').textContent.includes('cadastros')"),true);
  const artifactDirectory=path.resolve('../artifacts/pre-tests-review');
  fs.mkdirSync(artifactDirectory,{recursive:true});
  for(const theme of ['white','gray','dark']) for(const width of [1440,390]) {
    await send('Emulation.setDeviceMetricsOverride',{width,height:1100,deviceScaleFactor:1,mobile:false});
    await evaluate(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
    await pause(100);
    assert.equal(await evaluate("document.documentElement.scrollWidth<=innerWidth && document.querySelector('[role=dialog]').scrollWidth<=document.querySelector('[role=dialog]').clientWidth+1"),true,`preferences ${theme}/${width} overflow`);
    const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
    fs.writeFileSync(path.join(artifactDirectory,`campaign-preferences-${theme}-${width}.png`),Buffer.from(shot.data,'base64'));
  }
  await evaluate("[...document.querySelectorAll('[role=dialog] button')].find(b=>b.textContent==='Revogar bloqueio').click()");
  await wait("document.querySelector('#campaign-justification')");
  assert.equal(await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent==='Confirmar revogação').disabled"),true);
  await change('#campaign-justification','Responsavel confirmou a revogacao');
  await click('.campaign-confirm input');
  await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent==='Confirmar revogação').click()");
  await wait("window.qaPreferences[0].isActive===false && !document.querySelector('#campaign-justification')");
  assert.equal(await evaluate("window.qaPreferences[1].isActive"),true);
  await evaluate("[...document.querySelectorAll('[role=dialog] button')].find(b=>b.textContent==='Histórico').click()");
  await wait("document.querySelector('[aria-label=\"Histórico de restrições\"]')");
  assert.equal(await evaluate("document.querySelector('[aria-label=\"Histórico de restrições\"]').textContent.includes('2 eventos')"),true);
  await change('#campaign-scope','o');
  await change('#campaign-reason','Novo bloqueio solicitado');
  await evaluate("document.querySelector('.campaign-preference-form button.primary-button').click()");
  await wait("window.qaPreferences.length===3");
  assert.equal(await evaluate("window.qaPreferences[2].shoppingId"),'o');
  await click('[aria-label="Fechar restrições"]');
  await evaluate("[...document.querySelectorAll('.page-heading button')].find(button=>button.textContent.trim()==='Restrições de envio').click()");
  await wait("document.querySelector('[role=dialog]')?.textContent.includes('Registro permanente')");
  await wait("document.querySelectorAll('.campaign-preference-card').length===3");
  assert.equal(await evaluate("document.querySelector('#campaign-reason')===null"),true);
  await click('[aria-label="Fechar restrições"]');
  await evaluate('window.qaAdmin=false');
  await click('[title="Restrições de envio"]');
  await wait("document.querySelector('[role=dialog]')?.textContent.includes('Somente administradores')");
  assert.equal(await evaluate("document.querySelector('#campaign-reason')===null"),true);
  await click('[aria-label="Fechar restrições"]');
  await evaluate('window.qaPreferenceFailure=true');
  await click('[title="Restrições de envio"]');
  await wait("document.querySelector('[role=dialog] [role=alert]')");
  assert.equal(await evaluate("document.querySelector('#campaign-reason')===null"),true);
  await click('[aria-label="Fechar restrições"]');
  await evaluate("window.qaAdmin=true;window.qaPreferenceFailure=false");
  await click('[aria-label="Atualizar lista de contatos"]');
  await wait("document.querySelector('.identity-title')");
  assert.equal(await evaluate("document.querySelector('.identity-title').textContent.includes('Natália')"),true);
  await change('[aria-label="Filtrar por grupo"]','g');
  await wait("document.querySelector('[aria-label=\"Remover filtro Grupo\"]')");
  await click('[aria-label="Remover filtro Grupo"]');
  await wait("document.querySelector('[aria-label=\"Filtrar por grupo\"]').value===''");
  await wait("document.querySelector('.contacts-redesign tbody tr') && !document.querySelector('.results-summary').textContent.includes('Carregando')");
  await evaluate("window.qaRows[0].contactName='JOSE DA SILVA RESPONSAVEL PELA OPERACAO E TECNOLOGIA DO SHOPPING';window.qaRows[0].email='responsavel.operacoes.tecnologia.contato@example.invalid';window.qaRows[0].organizationContext.group.name='GRUPO AD ADMINISTRACAO DE SHOPPINGS E EMPREENDIMENTOS';window.qaRows[0].organizationContext.shopping.name='SHOPPING MOGI CENTRO DE COMPRAS E SERVICOS';");
  await click('[aria-label="Atualizar lista de contatos"]');
  await wait("document.querySelector('.identity-title')?.textContent.startsWith('JOSE DA SILVA')");
  await change('[aria-label="Filtrar por grupo"]','g');
  await wait("document.querySelector('.contacts-redesign tbody tr') && !document.querySelector('.results-summary').textContent.includes('Carregando')");
  for(const theme of ['white','gray','dark']) for(const width of [1440,768,390]) {
    await send('Emulation.setDeviceMetricsOverride',{width,height:1100,deviceScaleFactor:1,mobile:false});
    await evaluate(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
    await pause(100);
    assert.equal(await evaluate("document.documentElement.scrollWidth<=innerWidth"),true,`contacts ${theme}/${width}`);
    assert.equal(await evaluate("[...document.querySelectorAll('.identity-title,.contacts-redesign .cell-primary,.contacts-redesign .cell-secondary,.contacts-primary-filters .full-text-select-value')].every(e=>e.scrollWidth<=e.clientWidth+1 && getComputedStyle(e).textOverflow!=='ellipsis')"),true,`complete text ${theme}/${width}`);
    const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});
    fs.writeFileSync(path.join(artifactDirectory,`contacts-applied-${theme}-${width}.png`),Buffer.from(shot.data,'base64'));
  }
  await click('[aria-label="Configurações"]');
  await wait("document.querySelector('.settings-card-grid')");
  for (const width of [1440,390]) {
    await send('Emulation.setDeviceMetricsOverride',{width,height:1100,deviceScaleFactor:1,mobile:false});
    await pause(100);
    assert.equal(await evaluate("document.documentElement.scrollWidth<=innerWidth"),true);
    const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});
    fs.writeFileSync(path.join(artifactDirectory,`settings-home-${width}.png`),Buffer.from(shot.data,'base64'));
  }
  await evaluate("[...document.querySelectorAll('.settings-area-card')].find(button=>button.querySelector('strong').textContent==='Organizações').click()");
  await wait("document.querySelector('#settings-area-heading')?.textContent==='Organizações'");
  assert.equal(await evaluate("document.querySelectorAll('#main-navigation > button').length"),3);
  assert.equal(await evaluate("[...document.querySelectorAll('button')].some(button=>button.textContent.includes('Voltar às configurações'))"),true);
  await wait("document.querySelector('[aria-label=\"Expandir ANCAR\"]')");
  assert.equal(await evaluate("document.querySelectorAll('.settings-table tbody tr').length"),2);
  await click('[aria-label="Expandir ANCAR"]');
  assert.equal(await evaluate("document.querySelectorAll('.settings-table tbody tr').length"),4);
  await click('[aria-label="Recolher ANCAR"]');
  assert.equal(await evaluate("document.querySelectorAll('.settings-table tbody tr').length"),2);
  await evaluate("[...document.querySelectorAll('button')].find(button=>button.textContent==='Expandir todos').click()");
  assert.equal(await evaluate("document.querySelectorAll('.settings-table tbody tr').length"),4);
  await evaluate("[...document.querySelectorAll('button')].find(button=>button.textContent==='Recolher todos').click()");
  await change('.entity-toolbar input[type=search]','Shopping Paulista');
  assert.equal(await evaluate("document.querySelectorAll('.settings-table tbody tr').length"),2);
  await change('.entity-toolbar input[type=search]','');

  await wait("document.querySelector('.settings-table tbody tr')");
  await click('.settings-content .page-heading .primary-button');
  await wait("document.querySelector('#settings-organization-type')");
  await change('#settings-organization-type','os');
  assert.equal(await evaluate("[...document.querySelector('#settings-parent-organization').options].filter(o=>o.value).map(o=>o.value).join(',')"),'g');
  assert.equal(await evaluate("document.querySelector('label[for=settings-entity-name]').textContent.includes('shopping')"),true);
  await change('#settings-parent-organization','g');
  for(const theme of ['white','gray','dark']) for(const width of [1440,390]) {
    await send('Emulation.setDeviceMetricsOverride',{width,height:1100,deviceScaleFactor:1,mobile:false});
    await evaluate(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
    await pause(100);
    assert.equal(await evaluate("document.documentElement.scrollWidth<=innerWidth && document.querySelector('[role=dialog]').scrollWidth<=document.querySelector('[role=dialog]').clientWidth+1"),true,`settings ${theme}/${width}`);
    const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});
    fs.writeFileSync(path.join(artifactDirectory,`settings-applied-${theme}-${width}.png`),Buffer.from(shot.data,'base64'));
  }
  await change('#settings-organization-type','og');
  assert.equal(await evaluate("document.querySelector('#settings-parent-organization')===null"),true);
  assert.equal(await evaluate("document.querySelector('label[for=settings-entity-name]').textContent.includes('grupo')"),true);
  await click('[aria-label="Fechar formulário"]');
  await send('Page.reload');
  await wait("document.querySelector('.settings-content')");
  await evaluate("[...document.querySelectorAll('button')].find(button=>button.textContent.includes('Voltar às configurações')).click()");
  await wait("document.querySelector('.settings-card-grid')");
  assert.equal(await evaluate("document.querySelectorAll('#main-navigation > button').length"),3);
  await evaluate("[...document.querySelectorAll('.settings-area-card')].find(button=>button.querySelector('strong').textContent==='Importação e exportação').click()");
  await wait("document.querySelector('.exchange-content')");
  for(const width of [1440,390]){
    await send('Emulation.setDeviceMetricsOverride',{width,height:1100,deviceScaleFactor:1,mobile:false});await pause(100);
    assert.equal(await evaluate("document.documentElement.scrollWidth<=innerWidth"),true);
    const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});
    fs.writeFileSync(path.join(artifactDirectory,`exchange-center-${width}.png`),Buffer.from(shot.data,'base64'));
  }
  const ExcelJS=require('exceljs');
  const downloads=fs.mkdtempSync(path.join(directory,'downloads-'));
  await send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads});
  await change('.exchange-filters input[type=search]','Natália');
  await evaluate("[...document.querySelectorAll('.exchange-actions button')].find(button=>button.textContent==='Exportar Excel').click()");
  const exportedPath=path.join(downloads,'cadastros.xlsx');
  for(let attempt=0;attempt<100&&!fs.existsSync(exportedPath);attempt++)await pause(100);
  assert.equal(fs.existsSync(exportedPath),true,'unified export downloads an actual XLSX');
  const exportedBook=new ExcelJS.Workbook();await exportedBook.xlsx.load(fs.readFileSync(exportedPath));
  assert.equal(exportedBook.worksheets.length,1);assert.equal(exportedBook.worksheets[0].name,'Cadastros');
  assert.equal(exportedBook.worksheets[0].columnCount,8);
  assert.equal(await evaluate("new URL(window.qaRequests.filter(request=>request.url.startsWith('/data-exchange/export')).at(-1).url,'http://fixture').searchParams.get('search')"),'Natália');
  const workbook=new ExcelJS.Workbook(),sheet=workbook.addWorksheet('Cadastros');
  sheet.addRow(['Grupo','Organização / Shopping','Loja','Responsável','WhatsApp','Tipo de contato','E-mail','Ativo']);
  sheet.addRow(['AD','Shopping Mogi','Americanas','José','11999991234','Lojista','invalid','Sim']);
  const importPath=path.join(directory,'cadastros-fixture.xlsx');fs.writeFileSync(importPath,await workbook.xlsx.writeBuffer());
  const {root:documentRoot}=await send('DOM.getDocument');
  const {nodeId:uploadNode}=await send('DOM.querySelector',{nodeId:documentRoot.nodeId,selector:'input[type=file]'});
  await send('DOM.setFileInputFiles',{nodeId:uploadNode,files:[importPath]});
  await wait("document.querySelector('dialog[open] .exchange-summary')");
  assert.equal(await evaluate("[...document.querySelectorAll('dialog button')].find(button=>button.textContent==='Confirmar importação').disabled"),true);
  assert.equal(await evaluate("window.qaImportCommits||0"),0);
  await change('[aria-label="E-mail, linha 2"]','jose@example.invalid');
  await evaluate("[...document.querySelectorAll('dialog button')].find(button=>button.textContent==='Validar alterações').click()");
  await wait("window.qaImportPreview.canConfirm===true && document.querySelector('.exchange-row-review').textContent.includes('Criar shopping')");
  for(const width of [1440,390]){
    await send('Emulation.setDeviceMetricsOverride',{width,height:1100,deviceScaleFactor:1,mobile:false});await pause(100);
    assert.equal(await evaluate("document.documentElement.scrollWidth<=innerWidth && document.querySelector('dialog').scrollWidth<=document.querySelector('dialog').clientWidth+1"),true);
    const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});fs.writeFileSync(path.join(artifactDirectory,`exchange-review-${width}.png`),Buffer.from(shot.data,'base64'));
  }
  await send('Page.enable');
  await send('Page.handleJavaScriptDialog',{accept:true}).catch(()=>undefined);
  const confirmed=await evaluate("(()=>{window.confirm=()=>true;[...document.querySelectorAll('dialog button')].find(button=>button.textContent==='Confirmar importação').click();return true;})()");assert.equal(confirmed,true);
  await wait("document.querySelector('#excel-title')?.textContent==='Importação concluída'");
  assert.equal(await evaluate("window.qaImportCommits"),1);
  await click('[aria-label="Fechar importação"]');
  sheet.getCell('G2').value='jose@example.invalid';fs.writeFileSync(importPath,await workbook.xlsx.writeBuffer());
  await evaluate("window.qaAdmin=false;[...document.querySelectorAll('button')].find(button=>button.textContent.includes('Voltar às configurações')).click()");
  await wait("document.querySelector('.settings-card-grid')");
  await evaluate("[...document.querySelectorAll('.settings-area-card')].find(button=>button.querySelector('strong').textContent==='Importação e exportação').click()");
  await wait("document.querySelector('input[type=file]')");
  const {root:nextRoot}=await send('DOM.getDocument');const {nodeId:nextUpload}=await send('DOM.querySelector',{nodeId:nextRoot.nodeId,selector:'input[type=file]'});
  await send('DOM.setFileInputFiles',{nodeId:nextUpload,files:[importPath]});
  await wait("document.querySelector('dialog[open] .exchange-summary')");
  assert.equal(await evaluate("[...document.querySelectorAll('dialog button')].find(button=>button.textContent==='Confirmar importação').disabled"),true);
  assert.equal(await evaluate("window.qaImportCommits"),1);
  await click('[aria-label="Fechar importação"]');await evaluate('window.qaAdmin=true');
  await evaluate("window.location.hash='automatic-messages';window.dispatchEvent(new Event('hashchange'))");
  await wait("document.querySelectorAll('.automatic-template-card').length===1");
  assert.equal(await evaluate("document.querySelector('.recipient-notice').textContent.includes('Envio automático desabilitado')"),true);
  await click('.page-heading .primary-button');
  await wait("document.querySelector('[role=dialog] textarea')");
  await change('[role=dialog] input[maxlength="100"]','Início de atendimento');
  await change('[role=dialog] select','started');
  await change('[role=dialog] textarea','Olá, seu atendimento começou com {atendente}.');
  assert.equal(await evaluate("document.querySelector('.organization-context-card').textContent.includes('Maria (exemplo)')"),true);
  await click('[role=dialog] button[type="submit"]');
  await wait("document.querySelectorAll('.automatic-template-card').length===2 && !document.querySelector('[role=dialog]')");
  assert.equal(await evaluate("window.qaAutomaticTemplates[1].isActive"),false);
  assert.equal(await evaluate("window.qaRequests.filter(request=>request.url.startsWith('/automatic-messages') && request.method==='POST').length"),1);
  for(const width of [1440,390]){
    await send('Emulation.setDeviceMetricsOverride',{width,height:1100,deviceScaleFactor:1,mobile:false});await pause(100);
    assert.equal(await evaluate("document.documentElement.scrollWidth<=innerWidth"),true);
    const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});
    fs.writeFileSync(path.join(artifactDirectory,`automatic-models-${width}.png`),Buffer.from(shot.data,'base64'));
  }
  console.log(
    "Contacts browser QA passed: pagination, combined filters, Sem loja, three contexts, edit preservation, inactive references, direct organization, creation, preferences block/revoke/history/permissions/failure, 3 themes x 3 widths, cards/back navigation, folding organizations, unified XLSX download, import review/corrections/admin confirmation and existing model preview.",
  );
  await send("Browser.close");
} finally {
  socket?.close();
  chrome.kill();
  await pause(500);
  const resolvedProfile = path.resolve(profile);
  if (
    resolvedProfile.startsWith(path.resolve(os.tmpdir()) + path.sep) &&
    path.basename(resolvedProfile).startsWith("whatsgestor-contacts-")
  ) {
    try {
      fs.rmSync(resolvedProfile, { recursive: true, force: true });
    } catch {
      /* Browser files may still be closing. */
    }
  }
}
