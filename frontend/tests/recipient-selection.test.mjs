import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function load(file, globals = {}) {
  const exports = {};
  const compiled = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  vm.runInNewContext(compiled, { exports, ...globals });
  return exports;
}
const tokenA = "11111111-1111-4111-8111-111111111111";
const tokenB = "22222222-2222-4222-8222-222222222222";
test("selection storage holds opaque IDs only, rejects corrupt tokens and isolates users", () => {
  const storage = new Map();
  const api = load("components/bulk-send/selection-token.ts", {
    sessionStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    },
  });
  api.writeSelectionToken("a", tokenA);
  api.writeSelectionToken("b", tokenB);
  assert.equal(api.readSelectionToken("a"), tokenA);
  assert.equal(api.readSelectionToken("b"), tokenB);
  assert.equal(api.readSelectionToken("c"), null);
  api.writeSelectionToken("a", "contact data must not be stored");
  assert.equal(api.readSelectionToken("a"), tokenA);
  assert.deepEqual([...storage.values()].sort(), [tokenA, tokenB].sort());
});
test("blocked browser storage still preserves tokens for navigation during this session", () => {
  const api = load("components/bulk-send/selection-token.ts", {
    sessionStorage: {
      getItem() {
        throw Error("blocked");
      },
      setItem() {
        throw Error("blocked");
      },
    },
  });
  api.writeSelectionToken("a", tokenA);
  assert.equal(api.readSelectionToken("a"), tokenA);
  assert.equal(api.readSelectionToken("b"), null);
});
test("recipient API requests server pages and versioned operations without contact writes or send endpoints", async () => {
  const calls = [];
  const api = load("services/api/bulk-send.ts", {
    crypto: { randomUUID: () => tokenB },
    require: () => ({
      apiRequest: async (url, init = {}) => {
        calls.push({ url, ...init });
        return { id: tokenA, version: 3 };
      },
    }),
  });
  await api.createRecipientSelection({ groupId: tokenB });
  await api.getRecipientSelection(tokenA, 4, "selected");
  await api.updateRecipientSelection({ id: tokenA, version: 3 }, "all");
  assert.ok(calls[1].url.includes("page=4&pageSize=25&view=selected"));
  assert.deepEqual(JSON.parse(calls[2].body), { action: "all", version: 3, requestId: tokenB });
  assert.ok(
    calls.every((call) =>
      call.url.startsWith("/bulk-send/recipient-selections"),
    ),
  );
});

test("server recovery works without browser storage and progress/recovery remain under recipient endpoints", async () => {
  const calls = [];
  const api = load("services/api/bulk-send.ts", { require: () => ({ apiRequest: async (url, init = {}) => { calls.push({ url, ...init }); return { id: tokenA, version: 4 }; } }) });
  assert.equal((await api.getLatestRecipientSelection()).id, tokenA);
  await api.getSelectionOperation(tokenB);
  await api.recoverSelectionOperation(tokenB);
  assert.equal(calls[0].url, '/bulk-send/recipient-selections/latest');
  assert.equal(calls[1].url, `/bulk-send/recipient-selections/operations/${tokenB}`);
  assert.equal(calls[2].method, 'POST');
  assert.ok(calls[2].url.endsWith('/recover'));
});

test("operation requests retain a valid UUID on HTTP origins without crypto.randomUUID", async () => {
  let body;
  const api = load('services/api/bulk-send.ts', {
    crypto: { getRandomValues: bytes => { bytes.fill(1); return bytes; } },
    require: () => ({ apiRequest: async (_url, init) => { body = JSON.parse(init.body); return { id: tokenA, version: 1 }; } }),
  });
  await api.createRecipientSelection({});
  assert.match(body.requestId, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
});
