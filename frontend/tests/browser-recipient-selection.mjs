// Real recipient services + real React UI, isolated in-memory Contacts fixtures.
// No AppModule, SQL connection, WhatsApp socket or contact write is used.
// Build the backend first; run from frontend: node tests/browser-recipient-selection.mjs
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
const require = createRequire(import.meta.url);
const root = process.cwd();
const {
  RecipientCatalogService,
} = require("../../backend/dist/bulk-send/recipient-catalog.service.js");
const {
  RecipientSelectionsService,
} = require("../../backend/dist/bulk-send/recipient-selections.service.js");
const { webpack } = require("next/dist/compiled/webpack/webpack");
const WebSocket = require("../../backend/node_modules/ws");
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const group = {
  id: id(1001),
  name: "ANCAR",
  organizationType: { name: "Grupo" },
  isActive: true,
};
const shopping = {
  id: id(1002),
  name: "Shopping Paulista",
  organizationType: { name: "Shopping" },
  parentOrganizationId: group.id,
  parentOrganization: group,
  isActive: true,
};
const context = {
  organizationId: shopping.id,
  organizationType: "Shopping",
  group: { id: group.id, name: group.name },
  shopping: { id: shopping.id, name: shopping.name },
  hierarchyIssue: null,
};
const roles = [
  { id: id(2001), name: "Lojista", isActive: true },
  { id: id(2002), name: "TI", isActive: true },
  { id: id(2003), name: "ADM", isActive: true },
];
const contact = (
  n,
  name,
  role,
  phone = "11987654321",
  store = "Americanas",
) => ({
  id: id(n),
  contactName: name,
  phone,
  storeName: store,
  contactTypeId: role.id,
  contactType: role,
  organizationId: shopping.id,
  organization: shopping,
  organizationContext: context,
  isActive: true,
  email: null,
});
const rows = [
  contact(1, "Natália", roles[0]),
  contact(2, "Natália", roles[1]),
  contact(3, "Natália", roles[2], "+55 (11) 98765-4321", null),
  contact(4, "Natália", roles[0], "+55 (11) 98765-4321"),
  contact(5, "Contato inválido", roles[2], "12345", null),
  ...Array.from({ length: 57 }, (_, i) =>
    contact(
      10 + i,
      `Pessoa ${String(i).padStart(2, "0")}`,
      roles[1],
      String(5511987600000 + i),
      "Loja " + i,
    ),
  ),
];
const before = JSON.stringify(rows);
let contactWrites = 0;
let selectionCreates = 0;
function matches(row, filter) {
  const digits = (text) => String(text).replace(/\D/g, "");
  return (
    (!filter.groupId || row.organizationContext.group.id === filter.groupId) &&
    (!filter.shoppingId || row.organizationId === filter.shoppingId) &&
    (!filter.storeName || row.storeName === filter.storeName) &&
    (!filter.withoutStore || !row.storeName) &&
    (!filter.contactTypeId || row.contactTypeId === filter.contactTypeId) &&
    (!filter.contactName || row.contactName.includes(filter.contactName)) &&
    (!filter.phone || digits(row.phone).includes(digits(filter.phone))) &&
    (!filter.search || digits(row.phone).includes(digits(filter.search)))
  );
}
const contacts = {
  async findAll(filters) {
    const result = rows.filter((row) => matches(row, filters));
    const page = Number(filters.page || 1),
      pageSize = Number(filters.pageSize || 100);
    return {
      items: result.slice((page - 1) * pageSize, page * pageSize),
      total: result.length,
      page,
      pageSize,
    };
  },
  async selectionCandidates(filters, limit) {
    const result = rows.filter((row) => matches(row, filters));
    if (result.length > limit) throw new Error('Refine os filtros');
    return structuredClone(result);
  },
  async findByIds(ids) {
    return rows.filter((row) => ids.includes(row.id));
  },
};
const linkQuery = {
  orderBy() { return this; },
  limit() { return this; },
  innerJoin() {
    return this;
  },
  select() {
    return this;
  },
  addSelect() {
    return this;
  },
  where() {
    return this;
  },
  orWhere() {
    return this;
  },
  async getRawMany() {
    return [];
  },
};
let preferenceRules = [];
let preferencesUnavailable = false;
const preferences = {
  async snapshot() {
    if (preferencesUnavailable) throw Object.assign(new Error('Preferências indisponíveis'), { getStatus: () => 503 });
    return { status: "available", rules: preferenceRules };
  },
};
const { SqlRecipientSelectionStore } = require('../../backend/dist/bulk-send/recipient-selection-store.js');
const { SelectionDatabaseFixture } = require('../../backend/test/helpers/selection-database.fixture.cjs');
const selectionDatabase = new SelectionDatabaseFixture();
const selectionCatalog = new RecipientCatalogService(contacts, preferences, {
    createQueryBuilder: () => linkQuery,
  });
let selections = new RecipientSelectionsService(
  selectionCatalog,
  new SqlRecipientSelectionStore(selectionDatabase.asDataSource()),
);
const server = http.createServer(async (request, response) => {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,OPTIONS");
  if (request.method === "OPTIONS") {
    response.end();
    return;
  }
  try {
    const url = new URL(request.url, "http://fixture");
    let result;
    let body = "";
    for await (const chunk of request) body += chunk;
    const dto = body ? JSON.parse(body) : {};
    if (url.pathname === "/contacts/options")
      result = {
        organizationContexts: [
          {
            organizationId: group.id,
            organizationType: "Grupo",
            group: { id: group.id, name: group.name },
            shopping: null,
            hierarchyIssue: null,
          },
          context,
        ],
        storeNames: [
          ...new Set(rows.map((row) => row.storeName).filter(Boolean)),
        ],
      };
    else if (url.pathname === "/organizations") result = [group, shopping];
    else if (url.pathname === "/contact-types") result = roles;
    else if (url.pathname === "/contact-display-settings")
      result = [
        {
          id: "name",
          fieldKey: "contactName",
          isVisible: true,
          displayOrder: 1,
        },
      ];
    else if (url.pathname === "/contacts" && request.method === "GET")
      result = await contacts.findAll(Object.fromEntries(url.searchParams));
    else if (url.pathname.startsWith("/contacts")) {
      contactWrites++;
      throw Error("Contact writes forbidden in fixture");
    } else if (
      url.pathname === "/bulk-send/recipient-selections" &&
      request.method === "POST"
    ) {
      selectionCreates++;
      result = await selections.create("qa-user", dto.filters, dto.requestId);
    } else if (url.pathname === '/bulk-send/recipient-selections/latest') {
      result = await selections.latest('qa-user');
    } else if (url.pathname.startsWith('/bulk-send/recipient-selections/operations/')) {
      const parts = url.pathname.split('/');
      result = parts.at(-1) === 'recover' ? await selections.recover('qa-user', parts.at(-2)) : await selections.operation('qa-user',parts.at(-1));
    } else if (url.pathname.startsWith("/bulk-send/recipient-selections/")) {
      const token = url.pathname.split("/").at(-1);
      result =
        request.method === "PATCH"
          ? await selections.update("qa-user", token, dto)
          : await selections.get("qa-user", token, {
              page: Number(url.searchParams.get("page") || 1),
              pageSize: Number(url.searchParams.get("pageSize") || 25),
              view: url.searchParams.get("view") || "query",
            });
    } else throw Error("Unexpected fixture endpoint " + url.pathname);
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify(result));
  } catch (error) {
    response.statusCode = error.getStatus?.() || 500;
    response.end(JSON.stringify({ message: error.message }));
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
// Keep browser artifacts outside .next: a production build cleans that directory.
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "whatsgestor-campaign-qa-"));
fs.mkdirSync(directory, { recursive: true });
const write = (name, text) =>
  fs.writeFileSync(path.join(directory, name), text);
write("empty-css.cjs", "module.exports={};");
const profile = fs.mkdtempSync(
  path.join(os.tmpdir(), "whatsgestor-recipients-"),
);
write(
  "loader.cjs",
  `const ts=require(${JSON.stringify(path.join(root, "node_modules/typescript"))});module.exports=function(source){return ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2020}}).outputText;};`,
);
write(
  "auth.ts",
  `export const useAuth=()=>({user:{id:'qa-user',username:'Teste',isAdmin:true},logout:()=>{}});`,
);
write(
  "stubs.tsx",
  `export const SettingsContent=()=>null;export const WhatsappConnectionsScreen=()=>null;export const WhatsappConversationsScreen=()=>null;export const WhatsappMonitorScreen=()=>null;export const ProfileAvatar=()=>null;`,
);
write(
  "transport.ts",
  `window.qaRequests=[];export class ApiRequestError extends Error{constructor(message,status){super(message);this.status=status;}}export async function apiRequest(path,init={}){window.qaRequests.push({path,method:init.method||'GET',body:init.body?JSON.parse(init.body):null});const response=await fetch(${JSON.stringify(origin)}+path,{...init,headers:{'Content-Type':'application/json',...init.headers}});const data=await response.json();if(!response.ok)throw new ApiRequestError(data.message,response.status);return data;}export async function apiBlob(){return new Blob();}`,
);
write(
  "entry.tsx",
  `import React from 'react';import {createRoot} from 'react-dom/client';import {ContactsScreen} from ${JSON.stringify(path.join(root, "components/contacts/contacts-screen").replaceAll("\\", "/"))};createRoot(document.getElementById('root')).render(<ContactsScreen/>);`,
);
let chrome, socket;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
try {
  await new Promise((resolve, reject) =>
    webpack(
      {
        mode: "development",
        devtool: false,
        entry: path.join(directory, "entry.tsx"),
        output: { path: directory, filename: "bundle.js" },
        resolve: { extensions: [".tsx", ".ts", ".js"], alias: { "@": root }, modules:[path.join(root,"node_modules"),"node_modules"] },
        module: {
          rules: [{ test: /\.tsx?$/, use: path.join(directory, "loader.cjs") }],
        },
        plugins: [
          new webpack.NormalModuleReplacementPlugin(/campaign\.css$/,path.join(directory,"empty-css.cjs")),
          new webpack.NormalModuleReplacementPlugin(
            /auth-provider$/,
            path.join(directory, "auth.ts"),
          ),
          new webpack.NormalModuleReplacementPlugin(
            /(?:settings-screen|whatsapp-connections-screen|whatsapp-conversations-screen|whatsapp-monitor-screen|profile-avatar)$/,
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
    fs.readFileSync("app/themes.css", "utf8") + fs.readFileSync("components/bulk-send/campaign.css", "utf8") +
    ".sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}";
  write(
    "index.html",
    `<!doctype html><html data-theme="white"><meta charset="utf-8"><style>${css}</style><div id="root"></div><script src="bundle.js"></script></html>`,
  );
  chrome = spawn(
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    [
      "--headless=new",
      "--no-sandbox",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--remote-debugging-port=0",
      `--user-data-dir=${profile}`,
      "about:blank",
    ],
    { windowsHide: true, stdio: "ignore" },
  );
  const portFile = path.join(profile, "DevToolsActivePort");
  for (let i = 0; i < 100 && !fs.existsSync(portFile); i++) await pause(100);
  const port = fs.readFileSync(portFile, "utf8").split("\n")[0];
  const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  socket = new WebSocket(
    tabs.find((tab) => tab.type === "page").webSocketDebuggerUrl,
  );
  await new Promise((resolve) => socket.once("open", resolve));
  let sequence = 0;
  const pending = new Map();
  socket.on("message", (raw) => {
    const message = JSON.parse(raw);
    if (message.id) {
      const entry = pending.get(message.id);
      pending.delete(message.id);
      if (!entry) return;
      if (message.error) entry.reject(Error(message.error.message));
      else entry.resolve(message.result);
    }
  });
  socket.on("close", () => {
    for (const entry of pending.values())
      entry.reject(Error("Browser connection closed"));
    pending.clear();
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const next = ++sequence;
      const timer = setTimeout(() => {
        pending.delete(next);
        reject(Error("Timeout " + method));
      }, 15000);
      pending.set(next, {
        resolve: (result) => {
          clearTimeout(timer);
          resolve(result);
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
    for (let i = 0; i < 160; i++) {
      if (await evaluate(`Boolean(${expression})`)) return;
      await pause(50);
    }
    throw Error(
      "Timeout: " +
        expression +
        "\n" +
        (await evaluate("document.body.innerText.slice(-2500)")),
    );
  };
  const click = async (selector) => {
    await evaluate(
      `document.querySelector(${JSON.stringify(selector)}).click()`,
    );
    await pause(100);
  };
  const textClick = async (text) => {
    if(text==="Aplicar filtros" && !await evaluate("!!document.querySelector('dialog[open]')")) await textClick("Filtrar destinatários");
    await evaluate(
      `(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.includes(${JSON.stringify(text)}));if(!b)throw Error('Button missing');b.click()})()`,
    );
    await pause(100);
  };
  const change = async (selector, value) => {
    if(selector.includes("destinatários") && !await evaluate(`!!document.querySelector(${JSON.stringify(selector)})`)) await textClick("Filtrar destinatários");
    await evaluate(
      `(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(e.tagName==='SELECT'?HTMLSelectElement.prototype:e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}));})()`,
    );
    await pause(60);
  };
  const metric = async (label) =>
    evaluate(
      `(()=>{const dt=[...document.querySelectorAll('.recipient-metrics dt')].find(e=>e.textContent===${JSON.stringify(label)});return Number(dt?.nextElementSibling.textContent)})()`,
    );
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 1200,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await send("Page.navigate", {
    url: pathToFileURL(path.join(directory, "index.html")).href + "#contacts",
  });
  await wait("document.querySelector('tbody tr')");
  await click('[aria-label="Envio em Lote"]');
  await wait(
    "document.querySelectorAll('.recipient-table tbody tr').length===25",
  );
  assert.equal(await metric("Registros encontrados"), 62);
  assert.equal(await metric("Duplicidades na consulta"), 1);
  assert.equal(await metric("Impedidos na consulta"), 1);
  assert.equal(
    await evaluate(
      "document.querySelector('.recipient-table input[type=checkbox]').disabled",
    ),
    true,
  );
  await textClick("Selecionar todos os elegíveis");
  await wait(
    "[...document.querySelectorAll('.recipient-metrics dt')].find(e=>e.textContent==='Elegíveis selecionados')?.nextElementSibling.textContent==='60'",
  );
  assert.equal(await metric("Números únicos selecionados"), 58);
  preferenceRules = [{ normalizedPhone: '+5511987654321', shoppingId: null }];
  await textClick('Revalidar seleção');
  await wait("[...document.querySelectorAll('.recipient-metrics dt')].find(e=>e.textContent==='Elegíveis selecionados')?.nextElementSibling.textContent==='57'");
  preferenceRules = [];
  await textClick('Revalidar seleção');
  await wait("[...document.querySelectorAll('.recipient-metrics dt')].find(e=>e.textContent==='Elegíveis selecionados')?.nextElementSibling.textContent==='60'");
  preferencesUnavailable = true;
  await textClick('Revalidar seleção');
  await wait("document.querySelector('[role=alert]') && !document.querySelector('.recipient-metrics')");
  preferencesUnavailable = false;
  await textClick('Aplicar filtros');
  await wait("[...document.querySelectorAll('.recipient-metrics dt')].find(e=>e.textContent==='Elegíveis selecionados')?.nextElementSibling.textContent==='60'");
  assert.equal(selectionCreates, 1, 'Preference outages must not discard the server selection');
  await textClick("Próxima");
  await wait(
    "document.querySelector('.recipient-pagination').textContent.includes('Página 2')",
  );
  assert.equal(
    await evaluate(
      "[...document.querySelectorAll('.recipient-table input[type=checkbox]')].every(e=>e.checked)",
    ),
    true,
  );
  await click(".recipient-table input[type=checkbox]");
  await wait(
    "[...document.querySelectorAll('.recipient-metrics dt')].find(e=>e.textContent==='Elegíveis selecionados')?.nextElementSibling.textContent==='59'",
  );
  assert.equal(
    await evaluate(
      "document.querySelector('.recipient-pagination').textContent.includes('Página 2')",
    ),
    true,
  );
  await change('[aria-label="Grupo dos destinatários"]', group.id);
  await change('[aria-label="Shopping dos destinatários"]', shopping.id);
  await change(
    '[aria-label="Nome do responsável dos destinatários"]',
    "Natália",
  );
  await textClick("Aplicar filtros");
  await wait(
    "document.querySelectorAll('.recipient-table tbody tr').length===3",
  );
  assert.equal(await metric("Elegíveis selecionados"), 59);
  assert.equal(await metric("Registros encontrados"), 4);
  await textClick("Limpar seleção");
  await wait(
    "[...document.querySelectorAll('.recipient-metrics dt')].find(e=>e.textContent==='Elegíveis selecionados')?.nextElementSibling.textContent==='0'",
  );
  await change('[aria-label="Loja dos destinatários"]', "store:Americanas");
  await change('[aria-label="Função dos destinatários"]', roles[1].id);
  await change('[aria-label="Número dos destinatários"]', "11987654321");
  await textClick("Aplicar filtros");
  await wait(
    "document.querySelectorAll('.recipient-table tbody tr').length===1 && document.querySelector('.recipient-table tbody').textContent.includes('TI')",
  );
  await click(".recipient-table input[type=checkbox]");
  await wait(
    "[...document.querySelectorAll('.recipient-metrics dt')].find(e=>e.textContent==='Elegíveis selecionados')?.nextElementSibling.textContent==='1'",
  );
  await change('[aria-label="Loja dos destinatários"]', "none");
  await change('[aria-label="Função dos destinatários"]', "");
  await textClick("Aplicar filtros");
  await wait(
    "document.querySelectorAll('.recipient-table tbody tr').length===1 && document.querySelector('.recipient-table tbody').textContent.includes('ADM')",
  );
  assert.equal(await metric("Elegíveis selecionados"), 1);
  await click(".recipient-table input[type=checkbox]");
  await wait(
    "[...document.querySelectorAll('.recipient-metrics dt')].find(e=>e.textContent==='Elegíveis selecionados')?.nextElementSibling.textContent==='2'",
  );
  await textClick("Selecionados (");
  await wait(
    "document.querySelectorAll('.recipient-table tbody tr').length===2",
  );
  await textClick("Ver em Contatos");
  await wait("document.querySelector('h1')?.textContent==='Contatos'");
  assert.equal(
    await evaluate("!!document.querySelector('[role=dialog]')"),
    false,
  );
  await click('[aria-label="Envio em Lote"]');
  await wait("document.querySelector('.recipient-metrics')");
  assert.equal(await metric("Elegíveis selecionados"), 2);
  assert.equal(selectionCreates, 1);
  await change('[aria-label="Loja dos destinatários"]', "");
  await textClick("Aplicar filtros");
  await wait(
    "document.querySelectorAll('.recipient-table tbody tr').length===3",
  );
  await textClick("Selecionar todos os elegíveis");
  await wait(
    "[...document.querySelectorAll('.recipient-metrics dt')].find(e=>e.textContent==='Elegíveis selecionados')?.nextElementSibling.textContent==='3'",
  );
  assert.equal(await metric("Números únicos selecionados"), 1);
  assert.equal(
    await evaluate(
      "document.querySelectorAll('.recipient-content form').length",
    ),
    0,
  );
  assert.equal(
    await evaluate(
      "!!document.querySelector('.recipient-content input[id=contactName]')",
    ),
    false,
  );
  // Exercise the operational wizard components against the same isolated SQL-store fixture.
  const stage=async index=>{await click(`.bulk-step:nth-child(${index+1})`);await pause(100);};
  await stage(1);
  await wait("document.querySelector('#bulk-example')?.options.length===3");
  await change('#bulk-campaign-name','Reunião dos lojistas');
  await change('#bulk-message','Olá {responsavel}: {shopping}, {loja}, {grupo}, {funcao}.');
  const exampleWithStore=await evaluate("[...document.querySelector('#bulk-example').options].find(o=>o.textContent.includes('Americanas'))?.value");
  assert.ok(exampleWithStore,'Use a real selected recipient with a store for the preview');
  await change('#bulk-example',exampleWithStore);
  await wait("document.querySelector('[data-testid=campaign-preview]').textContent.includes('Americanas')");
  assert.ok((await evaluate("document.querySelector('[data-testid=campaign-preview]').textContent")).includes('ANCAR'));
  assert.ok((await evaluate("document.querySelector('[aria-label=\"Validações da mensagem\"]').textContent")).includes('sem loja'));
  await stage(0);assert.equal(await metric('Elegíveis selecionados'),3);
  await stage(1);assert.equal(await evaluate("document.querySelector('#bulk-message').value"),'Olá {responsavel}: {shopping}, {loja}, {grupo}, {funcao}.');
  await evaluate("document.querySelector('#bulk-message').focus();document.querySelector('#bulk-message').setSelectionRange(0,0)");
  await textClick('+ Grupo');
  assert.ok((await evaluate("document.querySelector('#bulk-message').value")).startsWith('{grupo}Olá'));
  await textClick('Salvar como modelo local');
  await wait("document.querySelector('.bulk-templates').textContent.includes('Reunião dos lojistas')");
  const fillAttachment=async(name,size,type)=>{
    await evaluate(`(()=>{const input=document.querySelector('[aria-label="Anexar arquivos à campanha"]');const data=new DataTransfer();data.items.add(new File([new Uint8Array(${size})],${JSON.stringify(name)},{type:${JSON.stringify(type)}}));input.files=data.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);await pause(100);
  };
  await fillAttachment('bloqueado.exe',20,'application/octet-stream');
  assert.ok((await evaluate("document.querySelector('.bulk-editor-grid').textContent")).includes('formato não aceito'));
  await fillAttachment('aviso.pdf',1000,'application/pdf');
  assert.equal(await evaluate("document.querySelectorAll('.bulk-attachments .bulk-attachment').length"),1);
  await stage(2);
  await change('#bulk-daily-limit','0');
  await wait("document.querySelector('[aria-label=\"Validações da programação\"]')?.textContent.includes('limite diário')");
  await change('#bulk-daily-limit','50');
  await change('#bulk-window-start','19:00');
  await wait("document.querySelector('[aria-label=\"Validações da programação\"]')?.textContent.includes('janela')");
  await change('#bulk-window-start','09:00');
  await stage(3);
  await wait("document.querySelector('.bulk-review-panel .bulk-message-bubble').textContent.includes('ANCAR')");
  assert.equal(await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent==='Iniciar campanha').disabled"),true);
  assert.ok((await evaluate("document.querySelector('.bulk-review-grid').textContent")).includes('aviso.pdf'));
  await textClick('Salvar rascunho local');
  await stage(4);
  await wait("document.querySelector('.bulk-draft')?.textContent.includes('Reunião dos lojistas')");
  await textClick('Agendadas');
  assert.equal(await evaluate("document.querySelectorAll('.bulk-draft').length"),0);
  await textClick('Rascunhos');
  const savedText=await evaluate("JSON.parse(localStorage.getItem('whatsgestor.campaign-preparation.v1.qa-user')).drafts[0].text");
  await send('Page.reload');
  await wait("document.querySelector('.recipient-metrics')");
  assert.equal(await metric('Elegíveis selecionados'),3,'SQL selection remains independent from local draft');
  await stage(4);
  await textClick('Recuperar rascunho');
  await wait("document.querySelector('#bulk-message')?.value.includes('{grupo}Olá')");
  assert.equal(await evaluate("document.querySelector('#bulk-message').value"),savedText);
  assert.ok((await evaluate("document.querySelector('.bulk-attachments').textContent")).includes('Selecione o arquivo novamente'));
  await fillAttachment('aviso.pdf',1000,'application/pdf');
  assert.equal(await evaluate("document.querySelectorAll('.bulk-attachments .bulk-attachment').length"),1,'Reattachment replaces missing file metadata');
  assert.equal(await evaluate("document.querySelector('.bulk-attachments').textContent.includes('Selecione o arquivo novamente')"),false);
  assert.equal(selectionCreates,1,'Wizard navigation and draft recovery do not recreate the SQL selection');
  await stage(0);
  const previews = path.resolve("../artifacts/bulk-campaign-operational");
  fs.mkdirSync(previews, { recursive: true });
  for (const theme of ["white", "gray", "dark"]) {
    for (const width of [1440, 768, 390, 320]) {
      await send("Emulation.setDeviceMetricsOverride", {
        width,
        height: 1300,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await evaluate(
        `document.documentElement.dataset.theme=${JSON.stringify(theme)}`,
      );
      await pause(100);
      assert.equal(
        await evaluate("document.documentElement.scrollWidth <= innerWidth"),
        true,
        `${theme}/${width} page overflow`,
      );
      if (width === 390) {
        const allNavigationVisible = await evaluate(
          "[...document.querySelectorAll('.sidebar .nav-item')].every(e=>e.getBoundingClientRect().bottom<=innerHeight&&e.getBoundingClientRect().top>=innerHeight-60)",
        );
        if (!allNavigationVisible)
          console.warn('Existing admin navigation with Monitor WhatsApp exceeds the mobile bar; outside recipient-selection scope. No layout changes applied.');
        assert.equal(
          await evaluate(
            "[...document.querySelectorAll('.sidebar .nav-item')].filter(e=>['Contatos','Envio em Lote'].includes(e.getAttribute('aria-label'))).every(e=>e.getBoundingClientRect().bottom<=innerHeight&&e.getBoundingClientRect().top>=innerHeight-60)",
          ),
          true,
          "Contacts and recipient-selection navigation remains visible on mobile",
        );
        assert.equal(
          await evaluate(
            "document.querySelector('.recipient-table-scroll').scrollWidth>document.querySelector('.recipient-table-scroll').clientWidth",
          ),
          true,
        );
      }
      const shot = await send("Page.captureScreenshot", {
        format: "png",
        captureBeyondViewport: true,
      });
      fs.writeFileSync(
        path.join(directory, `${theme}-${width}.png`),
        Buffer.from(shot.data, "base64"),
      );
      if (
        (theme === "white" && width === 1440) ||
        (theme === "dark" && width === 390)
      )
        fs.writeFileSync(
          path.join(previews, `recipient-selection-${theme}-${width}.png`),
          Buffer.from(shot.data, "base64"),
        );
      for(let index=1;index<5;index++){
        await stage(index);
        assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'),true,`${theme}/${width} stage ${index+1} page overflow`);
        const clipped=await evaluate("[...document.querySelectorAll('.bulk-wizard input,.bulk-wizard select,.bulk-wizard textarea,.bulk-wizard button')].filter(e=>e.getClientRects().length&&!e.closest('.recipient-table-scroll')).filter(e=>{const r=e.getBoundingClientRect();return r.left<0||r.right>innerWidth+1}).map(e=>e.textContent.slice(0,50))");
        assert.equal(clipped.length,0,`${theme}/${width} stage ${index+1} controls clipped: ${clipped}`);
        if(index===1&&((theme==='white'&&width===1440)||(theme==='dark'&&width===390))){
          await wait("!document.querySelector('.bulk-preview-area [role=status]')?.textContent.includes('Carregando')");
          const editorShot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});
          fs.writeFileSync(path.join(previews,`campaign-editor-${theme}-${width}.png`),Buffer.from(editorShot.data,'base64'));
        }
      }
      await stage(0);
      await textClick('Filtrar destinatários');
      assert.equal(await evaluate("[...document.querySelectorAll('dialog[open] input,dialog[open] select,dialog[open] button')].filter(e=>{const r=e.getBoundingClientRect();return r.left<0||r.right>innerWidth+1}).length"),0,`${theme}/${width} filter modal controls clipped`);
      if(theme==='white'&&width===1440){const modalShot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});fs.writeFileSync(path.join(previews,'campaign-filters-white-1440.png'),Buffer.from(modalShot.data,'base64'));}
      await click('[aria-label="Fechar janela"]');
    }
  }
  assert.equal(contactWrites, 0);
  assert.equal(
    await evaluate("window.qaRequests.every(request=>request.method==='GET'||request.path.startsWith('/bulk-send/recipient-selections'))"),
    true,
    'Every browser mutation stays within recipient selections; no contact/message/send mutation',
  );
  assert.equal(JSON.stringify(rows), before);
  selections = new RecipientSelectionsService(selectionCatalog, new SqlRecipientSelectionStore(selectionDatabase.asDataSource()));
  await evaluate('sessionStorage.clear(); localStorage.clear()');
  await send("Page.reload");
  await wait("document.querySelector('.recipient-metrics')");
  assert.equal(await evaluate("location.hash"), '#bulk-send');
  assert.equal(await metric("Elegíveis selecionados"), 3);
  assert.equal(selectionCreates, 1);
  console.log(
    "Recipient and campaign browser QA passed: actual selection services over simulated SQL, 62 source records / 61 recipients, 60 eligible across 3 pages; filters, duplicates, Sem loja, eligibility, navigation/F5/SQL selection restore; all five stages, five variables, cursor insertion, real-recipient preview, attachments, local models/draft save/reload/restore/reattach, scheduling validation, review, disabled send and empty operational history; 3 themes x 4 viewports; zero contact or message mutations.",
  );
  await send("Browser.close");
} finally {
  socket?.close();
  chrome?.kill();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await pause(500);
  const resolved = path.resolve(profile);
  if (
    resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) &&
    path.basename(resolved).startsWith("whatsgestor-recipients-")
  ) {
    try {
      fs.rmSync(resolved, { recursive: true, force: true });
    } catch {
      /* Browser may still be releasing temporary files. */
    }
  }
}
