import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
function load(path, globals = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(path, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  vm.runInNewContext(code, { exports, ...globals });
  return exports;
}
test("sidebar preference survives F5, isolates accounts and defaults invalid values", () => {
  const stored = new Map();
  const window = new EventTarget();
  window.localStorage = {
    getItem: (key) => stored.get(key) ?? null,
    setItem: (key, value) => stored.set(key, value),
  };
  const one = load("components/sidebar-preference.ts", { window, Event });
  one.writeSidebar("User-A", true);
  assert.equal(one.readSidebar("user-a"), true);
  assert.equal(one.readSidebar("user-b"), false);
  const reloaded = load("components/sidebar-preference.ts", { window, Event });
  assert.equal(reloaded.readSidebar("User-A"), true);
  reloaded.writeSidebar("user-a", false);
  assert.equal(reloaded.readSidebar("user-a"), false);
  stored.set("whatsgestor.sidebar.user-a", "invalid");
  assert.equal(reloaded.readSidebar("user-a"), false);
});
test("blocked storage still permits a temporary per-user menu preference", () => {
  const window = new EventTarget();
  window.localStorage = {
    getItem: () => {
      throw Error("blocked");
    },
    setItem: () => {
      throw Error("blocked");
    },
  };
  const api = load("components/sidebar-preference.ts", { window, Event });
  api.writeSidebar("a", true);
  assert.equal(api.readSidebar("a"), true);
  assert.equal(api.readSidebar("b"), false);
});
function photos(apiBlob) {
  return load("components/profile-photo-cache.ts", {
    require: () => ({ apiBlob }),
    AbortSignal,
  });
}
test("photos deduplicate requests, cache blobs and isolate users", async () => {
  let calls = 0;
  const blob = new Blob(["image"], { type: "image/jpeg" });
  const api = photos(async () => {
    calls++;
    return blob;
  });
  const [a, b] = await Promise.all([
    api.profilePhoto("a", "/photo"),
    api.profilePhoto("a", "/photo"),
  ]);
  assert.equal(a, blob);
  assert.equal(a, b);
  await api.profilePhoto("a", "/photo");
  assert.equal(calls, 1);
  await api.profilePhoto("b", "/photo");
  assert.equal(calls, 2);
});
test("unavailable photos, errors and unexpected formats yield fallback and are cached", async () => {
  for (const operation of [
    async () => new Blob([]),
    async () => {
      throw Error("private");
    },
    async () => new Blob(["svg"], { type: "image/svg+xml" }),
  ]) {
    let calls = 0;
    const api = photos(async () => {
      calls++;
      return operation();
    });
    assert.equal(await api.profilePhoto("a", "/photo"), null);
    assert.equal(await api.profilePhoto("a", "/photo"), null);
    assert.equal(calls, 1);
  }
});
test("initials work for names with accents, one name and missing names", () => {
  const api = photos(async () => null);
  assert.equal(api.contactInitials("  Ana Maria Silva "), "AS");
  assert.equal(api.contactInitials("Érica"), "É");
  assert.equal(api.contactInitials(""), "?");
});
