// Isolated browser QA with real React components and mocked auth/media; no app API.
// Run manually: node tests/browser-interface.mjs
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
const directory = path.join(root, ".next", "interface-qa");
fs.mkdirSync(directory, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "whatsgestor-ui-"));
const sourcePath = (file) =>
  JSON.stringify(path.join(root, file).replaceAll("\\", "/"));
fs.writeFileSync(
  path.join(directory, "loader.cjs"),
  `const ts=require(${sourcePath("node_modules/typescript")});module.exports=function(source){return ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2020}}).outputText;};`,
);
fs.writeFileSync(
  path.join(directory, "auth.ts"),
  `import {useSyncExternalStore} from 'react'; const a={id:'qa-a',username:'Teste A',isAdmin:true},b={id:'qa-b',username:'Teste B',isAdmin:false}; window.qaUser=a; window.qaSwap=()=>{window.qaUser=window.qaUser===a?b:a;window.dispatchEvent(new Event('qa-user'));}; export function useAuth(){const user=useSyncExternalStore(cb=>{window.addEventListener('qa-user',cb);return()=>window.removeEventListener('qa-user',cb);},()=>window.qaUser,()=>a); return {user,logout:()=>window.qaLogout=(window.qaLogout||0)+1};}`,
);
fs.writeFileSync(
  path.join(directory, "api.ts"),
  `window.qaUploads=0;window.qaAttachmentMode='success';export class ApiRequestError extends Error {constructor(message,status){super(message);this.status=status;}}export async function apiRequest(path, init={}) {const stored=JSON.parse(localStorage.getItem('qa-attachment')||'null');if(path.endsWith('/review')){if(!stored)throw new ApiRequestError('Missing',404);localStorage.removeItem('qa-attachment');return {...stored,state:'reviewed'};}if(init.method==='POST'){window.qaUploads++;await new Promise(resolve=>setTimeout(resolve,150));const file=init.body.get('file');const id=init.headers['Idempotency-Key'];if(window.qaAttachmentMode==='uncertain'){const row={id,state:'uncertain',originalName:file.name,message:null};localStorage.setItem('qa-attachment',JSON.stringify(row));throw new ApiRequestError('Uncertain',502);}return {id:'sent-'+window.qaUploads,conversationId:'qa-chat',fromMe:true,messageType:file.type==='application/pdf'?'document':'image'};}if(path.endsWith('/pending')){if(localStorage.getItem('qa-pending-down'))throw new ApiRequestError('Unavailable',503);return stored;}if(!stored)throw new ApiRequestError('Missing',404);return stored;}window.qaDownloads=0; window.qaRevokes=0;const revoke=URL.revokeObjectURL.bind(URL);URL.revokeObjectURL=url=>{window.qaRevokes++;revoke(url);}; export async function apiBlob(){window.qaDownloads++;return new Blob([window.qaBroken?'broken':\`<svg xmlns="http://www.w3.org/2000/svg" width="\${window.qaSmall?100:2560}" height="\${window.qaSmall?60:1600}"><rect width="100%" height="100%" fill="teal"/></svg>\`],{type:'image/svg+xml'});}`,
);
const sharp = require("../../backend/node_modules/sharp");
const { PDFDocument } = require("../../backend/node_modules/pdf-lib");
for (const format of ["jpeg", "png", "webp"])
  fs.writeFileSync(
    path.join(directory, `test.${format}`),
    await sharp({
      create: {
        width: 16,
        height: 12,
        channels: 3,
        background: { r: 30, g: 80, b: 60 },
      },
    })
      .toFormat(format)
      .toBuffer(),
  );
const testPdf = await PDFDocument.create();
testPdf.addPage([100, 100]);
fs.writeFileSync(path.join(directory, "test.pdf"), await testPdf.save());
fs.writeFileSync(path.join(directory, "invalid.png"), "not an image");
fs.writeFileSync(path.join(directory, "test.exe"), "not an attachment");
fs.writeFileSync(
  path.join(directory, "test.large.png"),
  Buffer.alloc(5 * 1024 * 1024 + 1),
);
fs.writeFileSync(
  path.join(directory, "entry.tsx"),
  `import {useState} from 'react';import {createRoot} from 'react-dom/client';import {AppShell} from ${sourcePath("components/app-shell")};import {ConversationMedia} from ${sourcePath("components/whatsapp/conversation-media")};import {useConversationSplit} from ${sourcePath("components/whatsapp/use-conversation-split")};import {useMessageScroll} from ${sourcePath("components/whatsapp/use-message-scroll")};import {AttachmentComposer} from ${sourcePath("components/whatsapp/attachment-composer")};
function Panels(){const [allowed,setAllowed]=useState(true);window.qaSetAttachmentAllowed=setAllowed;const {layoutRef,style,separator,reset}=useConversationSplit();const [visible,setVisible]=useState(true);const [version,setVersion]=useState(0);const [messages,setMessages]=useState(Array.from({length:100},(_,i)=>({id:String(i)})));window.qaAppend=()=>setMessages(m=>[...m,{id:String(m.length)}]);window.qaHide=()=>setVisible(false);window.qaRemount=()=>{setVisible(true);setVersion(v=>v+1);};const {viewportRef,contentRef,onScroll,showLatest,latest,followSentMessage}=useMessageScroll('qa-chat',messages,false);return <main className="main-content conversations-content"><section ref={layoutRef} style={style} className="conversations-layout mobile-show-chat"><aside id="conversation-list" className="conversation-list-panel"><div className="conversation-list-heading">Conversas<button className="split-reset" onClick={reset}>Restaurar</button></div><div className="conversation-items">Cliente</div></aside>{separator}<section id="conversation-chat" className="conversation-chat-panel"><div className="conversation-chat-header">Cliente</div><div className="conversation-history"><div ref={viewportRef} onScroll={onScroll} className="conversation-messages"><div ref={contentRef} className="conversation-messages-content">{messages.map(m=><article data-message-id={m.id} key={m.id} style={{minHeight:50}}>Mensagem {m.id}</article>)}{visible&&<ConversationMedia key={version} message={{id:'media-'+version,conversationId:'qa-chat',media:{kind:'image',availability:'ready',sizeBytes:10}}}/>}</div></div>{showLatest&&<button className="conversation-go-latest" onClick={latest}>Ir para a última mensagem</button>}</div><form className="conversation-composer" onSubmit={e=>e.preventDefault()}><AttachmentComposer conversationId="qa-chat" allowed={allowed} onBusy={()=>{}} onSent={message=>{window.qaLastAttachment=message;followSentMessage();setMessages(m=>m.some(row=>row.id===message.id)?m:[...m,message]);}}>{({button,preview})=><>{preview}<div className="conversation-composer-row">{button}<textarea aria-label="Mensagem" rows={2}/><button type="submit">Enviar</button></div></>}</AttachmentComposer></form></section></section></main>;}createRoot(document.getElementById('root')).render(<AppShell>{()=> <Panels/>}</AppShell>);`,
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
const results = [];
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
      pending.set(next, { resolve, reject });
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
  await send("Runtime.enable");
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
  await wait("document.querySelector('.sidebar-toggle')");
  await click('[aria-label="Conversas"]');
  await wait(
    "document.querySelector('.conversation-image-card img')?.complete",
  );
  assert.equal(await evaluate("!!document.querySelector('.topbar')"), false);
  assert.equal(await evaluate("window.qaDownloads"), 1);
  assert.equal(
    await evaluate(
      "getComputedStyle(document.querySelector('.sidebar-account-card')).display",
    ),
    "grid",
  );
  assert.equal(
    await evaluate(
      "getComputedStyle(document.querySelector('.sidebar-account-disclosure')).display",
    ),
    "none",
  );
  assert.equal(
    await evaluate(
      "(()=>{const card=document.querySelector('.sidebar-account-card').getBoundingClientRect(), sidebar=document.querySelector('.sidebar').getBoundingClientRect();return card.width>0&&card.left>=sidebar.left&&card.right<=sidebar.right})()",
    ),
    true,
  );
  await click(".sidebar-account-logout");
  assert.equal(await evaluate("window.qaLogout"), 1);
  await click(".sidebar-toggle");
  assert.equal(
    await evaluate(
      "document.querySelector('.app-shell').classList.contains('sidebar-collapsed')",
    ),
    true,
  );
  await click(".sidebar-account summary");
  await click(".sidebar-account-menu button");
  assert.equal(await evaluate("window.qaLogout"), 2);
  await click(".sidebar-account summary");
  assert.equal(
    await evaluate(
      "getComputedStyle(document.querySelector('.sidebar-account-card')).display",
    ),
    "none",
  );
  assert.equal(
    await evaluate(
      "getComputedStyle(document.querySelector('.sidebar-account-menu')).display",
    ),
    "none",
  );
  results.push(
    "Navegação sem topbar; cartão contido no menu expandido; somente ícone no recolhido; logout nos dois estados",
  );
  await evaluate("document.querySelector('.conversation-divider').focus()");
  const start = await evaluate(
    "+document.querySelector('.conversation-divider').getAttribute('aria-valuenow')",
  );
  await send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "ArrowRight",
    code: "ArrowRight",
  });
  await pause(100);
  assert.equal(
    await evaluate(
      "+document.querySelector('.conversation-divider').getAttribute('aria-valuenow')",
    ),
    start + 16,
  );
  const rect = await evaluate(
    "(()=>{const r=document.querySelector('.conversation-divider').getBoundingClientRect();return {x:r.x+4,y:r.y+100}})()",
  );
  await send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: rect.x,
    y: rect.y,
    button: "left",
    clickCount: 1,
  });
  await send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: rect.x + 70,
    y: rect.y,
    button: "left",
    buttons: 1,
  });
  await pause(100);
  await send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: rect.x + 70,
    y: rect.y,
    button: "left",
    clickCount: 1,
  });
  await pause(100);
  const saved = await evaluate(
    "+document.querySelector('.conversation-divider').getAttribute('aria-valuenow')",
  );
  assert.ok(saved > start + 16);
  await send("Page.reload");
  await wait("document.querySelector('.conversation-divider')");
  await pause(200);
  await click('[aria-label="Conversas"]');
  assert.equal(
    await evaluate(
      "+document.querySelector('.conversation-divider').getAttribute('aria-valuenow')",
    ),
    saved,
  );
  assert.equal(
    await evaluate(
      "document.querySelector('.app-shell').classList.contains('sidebar-collapsed')",
    ),
    true,
  );
  await evaluate("window.qaSwap()");
  await pause(100);
  assert.equal(
    await evaluate(
      "document.querySelector('.app-shell').classList.contains('sidebar-collapsed')",
    ),
    false,
  );
  assert.notEqual(
    await evaluate(
      "+document.querySelector('.conversation-divider').getAttribute('aria-valuenow')",
    ),
    saved,
  );
  await evaluate("window.qaSwap()");
  await pause(100);
  assert.equal(
    await evaluate(
      "+document.querySelector('.conversation-divider').getAttribute('aria-valuenow')",
    ),
    saved,
  );
  await click(".split-reset");
  results.push(
    "Divisória com mouse/teclado, F5, isolamento entre usuários e restauração",
  );
  async function selectAttachment(format) {
    const document = await send("DOM.getDocument");
    const node = await send("DOM.querySelector", {
      nodeId: document.root.nodeId,
      selector: "input[type=file]",
    });
    await send("DOM.setFileInputFiles", {
      nodeId: node.nodeId,
      files: [path.join(directory, `test.${format}`)],
    });
    await pause(100);
  }
  await evaluate("localStorage.setItem('qa-pending-down','yes')");
  await send("Page.reload");
  await wait("document.querySelector('.attachment-error button')");
  await click('[aria-label="Conversas"]');
  assert.equal(
    await evaluate("document.querySelector('.attachment-clip').disabled"),
    true,
  );
  await evaluate("localStorage.removeItem('qa-pending-down')");
  await click(".attachment-error button");
  await wait("!document.querySelector('.attachment-clip').disabled");
  for (const invalid of ["exe", "large.png"]) {
    const uploads = await evaluate("window.qaUploads");
    await selectAttachment(invalid);
    await wait("document.querySelector('.attachment-error')");
    assert.equal(
      await evaluate("!!document.querySelector('.attachment-preview')"),
      false,
    );
    assert.equal(await evaluate("window.qaUploads"), uploads);
    await click(".attachment-error button");
  }
  for (const format of ["jpeg", "png", "webp", "pdf"]) {
    await selectAttachment(format);
    await wait("document.querySelector('.attachment-preview')");
    const before = await evaluate("window.qaUploads");
    await evaluate(
      "document.querySelector('.attachment-send').click();document.querySelector('.attachment-send').click()",
    );
    await wait("!document.querySelector('.attachment-preview')");
    assert.equal(await evaluate("window.qaUploads"), before + 1);
  }
  await selectAttachment("png");
  const beforeCancel = await evaluate("window.qaUploads");
  await click(".attachment-preview .secondary-button");
  assert.equal(await evaluate("window.qaUploads"), beforeCancel);
  assert.equal(
    await evaluate("!!document.querySelector('.attachment-preview')"),
    false,
  );
  await evaluate("window.qaSetAttachmentAllowed(false)");
  await pause(100);
  assert.equal(
    await evaluate("document.querySelector('.attachment-clip').disabled"),
    true,
  );
  await evaluate("window.qaSetAttachmentAllowed(true)");
  await pause(100);
  await evaluate("window.qaAttachmentMode='uncertain'");
  await selectAttachment("pdf");
  await click(".attachment-send");
  await wait(
    "document.querySelector('.attachment-clip').disabled && document.querySelector('.attachment-notice button')",
  );
  await metrics(320, 568);
  // Reserve the space of the real page's controls and attendance toolbar.
  await evaluate(
    "document.querySelector('.conversations-content').style.paddingTop='127px';document.querySelector('.conversation-chat-header').style.minHeight='118px'",
  );
  assert.equal(
    await evaluate(
      "document.documentElement.scrollWidth<=innerWidth && document.documentElement.scrollHeight<=innerHeight+1",
    ),
    true,
  );
  assert.equal(
    await evaluate(
      "document.querySelector('.conversation-composer-row').getBoundingClientRect().bottom<=innerHeight-56",
    ),
    true,
  );
  await metrics(1440, 900);
  await send("Page.reload");
  await wait("document.querySelector('.attachment-notice button')");
  await click('[aria-label="Conversas"]');
  assert.equal(
    await evaluate("document.querySelector('.attachment-clip').disabled"),
    true,
  );
  await click(".attachment-notice button");
  await wait("!document.querySelector('.attachment-clip').disabled");
  results.push(
    "Anexos JPEG/PNG/WebP/PDF com prévia real, cancelamento, conexão indisponível, clique repetido e incerteza persistida após F5; API simulada",
  );

  await wait(
    "document.querySelector('.conversation-image-card img')?.complete",
  );
  const downloads = await evaluate("window.qaDownloads");
  const scroll = await evaluate(
    "document.querySelector('.conversation-messages').scrollTop",
  );
  await click(".conversation-image-card");
  await wait(
    "document.querySelector('.image-viewer')?.open && document.querySelector('.image-viewer-actions button')?.disabled",
  );
  await click('[aria-label="Ampliar zoom"]');
  assert.equal(
    await evaluate(
      "document.querySelector('.image-viewer output').textContent",
    ),
    "125%",
  );
  const view = await evaluate(
    "(()=>{const r=document.querySelector('.image-viewer-viewport').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()",
  );
  await send("Input.dispatchMouseEvent", {
    type: "mouseWheel",
    x: view.x,
    y: view.y,
    deltaX: 0,
    deltaY: -300,
  });
  await pause(100);
  assert.ok(
    await evaluate(
      "parseInt(document.querySelector('.image-viewer output').textContent)>125",
    ),
  );
  await send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: view.x,
    y: view.y,
    button: "left",
    clickCount: 1,
  });
  await send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: view.x + 80,
    y: view.y + 50,
    button: "left",
    buttons: 1,
  });
  await send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: view.x + 80,
    y: view.y + 50,
    button: "left",
    clickCount: 1,
  });
  await pause(100);
  assert.match(
    await evaluate(
      "document.querySelector('.image-viewer img').style.transform",
    ),
    /translate\((?!0px, 0px)/,
  );
  await click('[aria-label="Restaurar zoom"]');
  assert.equal(
    await evaluate(
      "document.querySelector('.image-viewer output').textContent",
    ),
    "100%",
  );
  await send("Emulation.setTouchEmulationEnabled", {
    enabled: true,
    maxTouchPoints: 2,
  });
  await send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [
      { x: view.x - 50, y: view.y, id: 1 },
      { x: view.x + 50, y: view.y, id: 2 },
    ],
  });
  await send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [
      { x: view.x - 100, y: view.y, id: 1 },
      { x: view.x + 100, y: view.y, id: 2 },
    ],
  });
  await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await pause(150);
  assert.ok(
    await evaluate(
      "parseInt(document.querySelector('.image-viewer output').textContent)>100",
    ),
  );
  await send("Emulation.setTouchEmulationEnabled", { enabled: false });
  await send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Escape",
    code: "Escape",
  });
  await wait("!document.querySelector('.image-viewer')");
  assert.equal(
    await evaluate("document.activeElement.className"),
    "conversation-image-card",
  );
  assert.equal(
    await evaluate(
      "document.querySelector('.conversation-messages').scrollTop",
    ),
    scroll,
  );
  assert.equal(await evaluate("window.qaDownloads"), downloads);
  await evaluate("window.qaHide()");
  await pause(100);
  assert.ok(await evaluate("window.qaRevokes>0"));
  await evaluate("window.qaSmall=true;window.qaRemount()");
  await wait(
    "document.querySelector('.conversation-image-card img')?.complete",
  );
  await click(".conversation-image-card");
  await wait(
    "document.querySelector('.image-viewer-toolbar small')?.textContent==='100 × 60 px'",
  );
  await click('[aria-label="Fechar visualizador"]');
  await evaluate("window.qaHide()");
  await pause(100);
  await evaluate("window.qaBroken=true;window.qaRemount()");
  await wait("document.querySelector('.conversation-media [role=alert]')");
  results.push(
    "Imagens grande/pequena/indisponível; zoom, roda, pan, reset, Esc, foco, scroll, um download e revogação",
  );
  await evaluate("window.qaHide()");
  await pause(100);
  const atEnd = await evaluate(
    "(()=>{const v=document.querySelector('.conversation-messages');return v.scrollHeight-v.clientHeight-v.scrollTop<2})()",
  );
  assert.equal(atEnd, true);
  await evaluate(
    "document.querySelector('.conversation-messages').scrollTop=600",
  );
  await pause(100);
  const reading = await evaluate(
    "document.querySelector('.conversation-messages').scrollTop",
  );
  await evaluate("window.qaAppend()");
  await pause(100);
  assert.equal(
    await evaluate(
      "document.querySelector('.conversation-messages').scrollTop",
    ),
    reading,
  );
  assert.equal(
    await evaluate("!!document.querySelector('.conversation-go-latest')"),
    true,
  );
  await click(".conversation-go-latest");
  await evaluate("window.qaAppend()");
  await pause(100);
  assert.equal(
    await evaluate(
      "(()=>{const v=document.querySelector('.conversation-messages');return v.scrollHeight-v.clientHeight-v.scrollTop<2})()",
    ),
    true,
  );
  for (const theme of ["white", "gray", "dark"]) {
    await evaluate(
      `document.documentElement.dataset.theme=${JSON.stringify(theme)}`,
    );
    await metrics(1440, 900);
    await click(".sidebar-toggle");
    assert.equal(
      await evaluate(
        "(()=>{const card=document.querySelector('.sidebar-account-card').getBoundingClientRect(), sidebar=document.querySelector('.sidebar').getBoundingClientRect();return card.width>0&&card.left>=sidebar.left&&card.right<=sidebar.right})()",
      ),
      true,
    );
    await click(".sidebar-toggle");
    assert.equal(
      await evaluate(
        "getComputedStyle(document.querySelector('.sidebar-account-card')).display",
      ),
      "none",
    );
    assert.equal(
      await evaluate(
        "getComputedStyle(document.querySelector('.sidebar-account-menu')).display",
      ),
      "none",
    );
    for (const [width, height] of [
      [1440, 900],
      [1024, 768],
      [390, 844],
      [320, 568],
    ]) {
      await metrics(width, height);
      assert.equal(
        await evaluate("document.documentElement.scrollWidth<=innerWidth"),
        true,
      );
      assert.equal(
        await evaluate("document.documentElement.scrollHeight<=innerHeight+1"),
        true,
      );
      assert.equal(
        await evaluate(
          "(()=>{const r=document.querySelector('.conversation-composer').getBoundingClientRect();return r.bottom<=innerHeight&&r.height>0})()",
        ),
        true,
      );
      if (width <= 390)
        assert.equal(
          await evaluate(
            "getComputedStyle(document.querySelector('.conversation-divider')).display",
          ),
          "none",
        );
    }
  }
  results.push(
    "Histórico longo, leitura preservada, botão última mensagem, seguimento de novas mensagens; três temas e quatro resoluções; gesto de pinça",
  );
  await metrics(1440, 900);
  await evaluate(
    "window.qaBroken=false;window.qaSmall=false;window.qaRemount()",
  );
  await wait(
    "document.querySelector('.conversation-image-card img')?.complete",
  );
  for (const theme of ["white", "gray", "dark"]) {
    await evaluate(
      `document.documentElement.dataset.theme=${JSON.stringify(theme)}`,
    );
    for (const [width, height] of [
      [1440, 900],
      [320, 568],
    ]) {
      await metrics(width, height);
      await selectAttachment("png");
      await wait("document.querySelector('.attachment-preview img')?.complete");
      assert.equal(
        await evaluate(
          "document.documentElement.scrollWidth<=innerWidth && document.documentElement.scrollHeight<=innerHeight+1",
        ),
        true,
      );
      assert.equal(
        await evaluate(
          "(()=>{const r=document.querySelector('.conversation-composer').getBoundingClientRect();return r.bottom<=innerHeight&&r.height>0})()",
        ),
        true,
      );
      const page = await send("Page.captureScreenshot", { format: "png" });
      fs.writeFileSync(
        path.join(directory, `${theme}-${width}-layout.png`),
        Buffer.from(page.data, "base64"),
      );
      await click(".conversation-image-card");
      await wait("document.querySelector('.image-viewer')?.open");
      assert.equal(
        await evaluate(
          "(()=>{const r=document.querySelector('.image-viewer').getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight})()",
        ),
        true,
      );
      const screenshot = await send("Page.captureScreenshot", {
        format: "png",
      });
      fs.writeFileSync(
        path.join(directory, `${theme}-${width}-viewer.png`),
        Buffer.from(screenshot.data, "base64"),
      );
      await click('[aria-label="Fechar visualizador"]');
      await click(".attachment-preview .secondary-button");
    }
  }
  fs.writeFileSync(
    path.join(directory, "results.json"),
    JSON.stringify(results, null, 2),
  );
  console.log(JSON.stringify(results, null, 2));
  await send("Browser.close");
} finally {
  socket?.close();
  chrome.kill();
  // Only the isolated profile created above is removed; no existing browser/session.
  await pause(500);
  try {
    fs.rmSync(profile, { recursive: true, force: true });
  } catch {
    /* Windows may still release browser files. */
  }
}
