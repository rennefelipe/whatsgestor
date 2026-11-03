// Isolated users UI QA with real React components and mocked auth/API.
// Run manually: node tests/browser-users.mjs
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url);
const { webpack } = require("next/dist/compiled/webpack/webpack");
const { NormalModuleReplacementPlugin } = webpack;
const WebSocket = require("../../backend/node_modules/ws");
const root = process.cwd();
const directory = path.join(root, ".next", "users-qa");
fs.mkdirSync(directory, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "whatsgestor-ui-"));
const sourcePath = (file) =>
  JSON.stringify(path.join(root, file).replaceAll("\\", "/"));
fs.writeFileSync(
  path.join(directory, "loader.cjs"),
  `const ts=require(${sourcePath("node_modules/typescript")});module.exports=function(source){return ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2020}}).outputText;};`,
);

fs.writeFileSync(path.join(directory,'auth.ts'),`export function useAuth(){return {user:{id:'admin',username:'admin',isAdmin:window.qaIsAdmin!==false,role:window.qaRole},logout:()=>{window.qaLogout=true}}}`);
fs.writeFileSync(path.join(directory,'api.ts'),`window.qaRows=[{id:'admin',username:'admin',isAdmin:true,isActive:true,canDelete:false},{id:'agent',username:'agente',isAdmin:false,isActive:true,canDelete:false},{id:'inactive',username:'inativo',isAdmin:false,isActive:false,canDelete:false}];window.qaCalls=[];export async function apiRequest(path,init={}){if(path==='/users/schema')return {profileFieldsAvailable:window.qaSchemaEnabled!==false};if(!init.method)return window.qaRows.map(x=>({...x}));const body=JSON.parse(init.body);window.qaCalls.push({path,body});if(init.method==='POST'){if(window.qaRows.some(x=>x.username===body.username))throw Error('Login duplicado.');const row={...body,id:'novo'};delete row.password;window.qaRows.push(row);return row;}const i=window.qaRows.findIndex(x=>x.id===path.split('/')[2]);window.qaRows[i]={...window.qaRows[i],...body};delete window.qaRows[i].password;return window.qaRows[i];}`);
fs.writeFileSync(path.join(directory,'entry.tsx'),`import {createRoot} from 'react-dom/client';import {AppShell} from ${sourcePath('components/app-shell')};import {UsersManagement} from ${sourcePath('components/settings/users-management')};import {ContactList} from ${sourcePath('components/contacts/contact-list')};const root=createRoot(document.getElementById('root'));let version=0;window.qaRender=()=>root.render(<AppShell key={version++}>{(section)=> <main className="main-content" data-section={section}>{window.qaRole==='tester'?<ContactList readOnly contacts={[{id:'contact',contactName:'Pessoa Consulta',phone:'11999990000',isActive:true}]} settings={[]} busyContactId={null} onEdit={()=>{throw Error('Cannot edit')}} onToggleActive={()=>{throw Error('Cannot activate')}}/>:<UsersManagement/>}</main>}</AppShell>);window.qaRender();window.confirm=()=>window.qaAccept!==false;`);
await new Promise((resolve, reject) =>
  webpack(
    {
      mode: "development",
      devtool: false,
      entry: path.join(directory, "entry.tsx"),
      output: { path: directory, filename: "bundle.js" },
      resolve: { extensions: [".tsx", ".ts", ".js"], alias: { "@": root } },
      module: {
        rules: [{ test: /\.tsx?$/, use: path.join(directory, "loader.cjs") }],
      },
      plugins: [
        new NormalModuleReplacementPlugin(
          /auth-provider$/,
          path.join(directory, "auth.ts"),
        ),
        new NormalModuleReplacementPlugin(
          /(?:services[\\/]api[\\/]client|\.\/client)(?:\.ts)?$/,
          path.join(directory, "api.ts"),
        ),
      ],
    },
    (error, stats) =>
      error || stats.hasErrors()
        ? reject(error ?? Error(stats.toString({ all: false, errors: true })))
        : resolve(),
  ),
);
const css =
  fs
    .readFileSync(path.join(root, "app/globals.css"), "utf8")
    .replace('@import "tailwindcss";', "") +
  fs.readFileSync(path.join(root, "app/themes.css"), "utf8");
fs.writeFileSync(
  path.join(directory, "index.html"),
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
  for (let i = 0; i < 100 && !fs.existsSync(portFile); i++) await pause(100);
  const port = fs.readFileSync(portFile, "utf8").split("\n")[0];
  const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  socket = new WebSocket(
    tabs.find((tab) => tab.type === "page").webSocketDebuggerUrl,
  );
  await new Promise((resolve) => socket.once("open", resolve));
  let id = 0;
  const pending = new Map();
  socket.on("close", () => {
    for (const entry of pending.values()) entry.reject(Error("Browser connection closed"));
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
      const timer = setTimeout(() => { pending.delete(next); reject(Error(`Browser timeout: ${method}`)); }, 15000);
      pending.set(next, { resolve: (value) => { clearTimeout(timer); resolve(value); }, reject: (error) => { clearTimeout(timer); reject(error); } });
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
    for (let i = 0; i < 100; i++) {
      if (await evaluate(`Boolean(${expression})`)) return;
      await pause(50);
    }
    console.error(
      await evaluate(
        "JSON.stringify({url:location.href,html:document.body?.innerHTML.slice(0,1000)})",
      ),
    );
    throw Error("Timeout: " + expression);
  };
  const click = async (selector) => {
    await evaluate(
      `document.querySelector(${JSON.stringify(selector)}).focus({preventScroll:true});document.querySelector(${JSON.stringify(selector)}).click()`,
    );
    await pause(100);
  };
  socket.on("message", (raw) => {
    const message = JSON.parse(raw);
    if (message.method === "Runtime.exceptionThrown")
      console.error(JSON.stringify(message.params));
  });
  // Runtime.evaluate does not require the optional exception event stream.
  await send("Page.enable");
  const metrics = async (width, height) => {
    await send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await pause(150);
  };
  await metrics(1440, 900);
  const navigation = await send("Page.navigate", {
    url: pathToFileURL(path.join(directory, "index.html")).href,
  });
  if (navigation.errorText) throw Error(navigation.errorText);

  await wait("document.querySelectorAll('tbody tr').length===3");
  const fill=async(selector,value)=>{await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(e.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}));})()`);await pause(100);};
  const textClick=async(text)=>{await evaluate(`[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(text)}).click()`);await pause(100);};
  const submit=async()=>{await evaluate("document.querySelector('[role=dialog] form').requestSubmit()");await pause(150);};
  assert.equal(await evaluate("document.querySelector('.users-stat-active strong').textContent"),'2');
  await fill('input[type=search]','AGENTE');assert.equal(await evaluate("document.querySelectorAll('tbody tr').length"),1);await fill('input[type=search]','');
  await fill('.users-filters select','administrator');assert.equal(await evaluate("document.querySelectorAll('tbody tr').length"),1);await fill('.users-filters select','');
  await fill('.users-filters label:last-child select','inactive');assert.equal(await evaluate("document.querySelectorAll('tbody tr').length"),1);await fill('.users-filters label:last-child select','');
  await textClick('Novo usuário');await fill('#user-full-name','Pessoa Testadora');await fill('#user-email','pessoa@example.invalid');await fill('#user-profile','tester');await fill('#user-username','novo');await fill('#user-password','Teste-123456');await fill('#user-password-confirmation','Diferente-123');await submit();assert.equal(await evaluate('window.qaCalls.length'),0);
  await fill('#user-password-confirmation','Teste-123456');await submit();await wait("document.querySelectorAll('tbody tr').length===4");assert.equal(await evaluate('window.qaCalls[0].body.canDelete'),false);
  assert.equal(await evaluate('window.qaCalls[0].body.role'),'tester');
  assert.equal(await evaluate('window.qaCalls[0].body.fullName'),'Pessoa Testadora');
  assert.equal(await evaluate('window.qaCalls[0].body.email'),'pessoa@example.invalid');
  await fill('input[type=search]','Pessoa');assert.equal(await evaluate("document.querySelectorAll('tbody tr').length"),1);await fill('input[type=search]','');
  await fill('.users-filters select','tester');assert.equal(await evaluate("document.querySelectorAll('tbody tr').length"),1);await fill('.users-filters select','');
  await textClick('Novo usuário');await fill('#user-full-name','Pessoa Testadora');await fill('#user-email','pessoa@example.invalid');await fill('#user-profile','tester');await fill('#user-username','novo');await fill('#user-password','Teste-123456');await fill('#user-password-confirmation','Teste-123456');await submit();assert.equal(await evaluate("document.querySelector('.form-error').textContent"),'Login duplicado.');await textClick('Cancelar');
  await click('[aria-label="Editar usuário agente"]');await fill('#user-username','renomeado');await evaluate('window.qaAccept=false');const before=await evaluate('window.qaCalls.length');await submit();assert.equal(await evaluate('window.qaCalls.length'),before);await evaluate('window.qaAccept=true');await submit();
  await wait("document.querySelector('tbody').textContent.includes('renomeado')");
  await evaluate("[...document.querySelectorAll('tbody tr')].find(e=>e.textContent.includes('renomeado')).querySelectorAll('button')[1].click()");await pause(100);assert.equal(await evaluate("!!document.querySelector('#user-username')"),false);
  await fill('#user-password','Nova-senha-123');await fill('#user-password-confirmation','Nova-senha-123');await submit();assert.deepEqual(await evaluate('Object.keys(window.qaCalls.at(-1).body)'),['password']);
  await click('[aria-label="Desativar usuário renomeado"]');assert.equal(await evaluate("window.qaRows.find(e=>e.id==='agent').isActive"),false);await click('[aria-label="Ativar usuário renomeado"]');assert.equal(await evaluate("window.qaRows.find(e=>e.id==='agent').isActive"),true);
  await evaluate("document.querySelector('tbody tr button').click()");await pause(100);assert.equal(await evaluate("!!document.querySelector('.users-permissions')"),true);
  fs.writeFileSync(path.join(directory,'desktop.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true})).data,'base64'));
  await metrics(390,844);assert.equal(await evaluate('document.documentElement.scrollWidth<=window.innerWidth'),true);
  fs.writeFileSync(path.join(directory,'mobile.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true})).data,'base64'));
  await evaluate('window.qaSchemaEnabled=false;window.qaRender()');await wait("document.querySelectorAll('tbody tr').length===4");
  await textClick('Novo usuário');assert.equal(await evaluate("!!document.querySelector('#user-full-name')"),false);assert.equal(await evaluate("!!document.querySelector('#user-profile option[value=tester]')"),false);await textClick('Cancelar');
  await evaluate('window.qaIsAdmin=false;window.qaRender()');await pause(150);assert.equal(await evaluate("!!document.querySelector('[aria-label=Usuários]')"),false);assert.equal(await evaluate("!!document.querySelector('.users-table')"),false);
  await evaluate("window.qaRole='tester';window.location.hash='users';window.qaRender()");await pause(150);
  assert.equal(await evaluate("document.querySelectorAll('#main-navigation button').length"),1);
  assert.equal(await evaluate("document.querySelector('main').dataset.section"),'contacts');
  assert.equal(await evaluate("document.querySelectorAll('.contact-table tbody button').length"),0);
  assert.equal(await evaluate("document.querySelector('.contact-table').textContent.includes('Somente consulta')"),true);
  console.log('PASS: name, optional email, tester role, search by name, legacy schema gating, tester navigation and read-only contacts;  indicators, search, filters, create, duplicate, password validation, edit, confirmation, reset, activation, permissions, responsive layout, non-admin UI; mocked API only.');
  await send('Browser.close');
} finally {
  socket?.close();
  chrome.kill();
  // Only the isolated profile created above is removed; no existing browser/session.
  await pause(500);
  try {
    const resolvedProfile = path.resolve(profile);
    if (path.dirname(resolvedProfile) !== path.resolve(os.tmpdir()) || !path.basename(resolvedProfile).startsWith('whatsgestor-ui-')) throw Error('Unexpected isolated browser profile path');
    fs.rmSync(resolvedProfile, { recursive: true, force: true });
  } catch {
    /* Windows may still release browser files. */
  }
}
