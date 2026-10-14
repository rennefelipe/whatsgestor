import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function load(file, globals = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  vm.runInNewContext(code, { exports, ...globals });
  return exports;
}
test("split limits protect chat width and clamp saved widths after resizing", () => {
  const { panelWidth, panelLimits } = load(
    "components/whatsapp/panel-width.ts",
  );
  assert.equal(panelWidth(1200, null), 330);
  assert.equal(panelWidth(700, 480), 372);
  assert.equal(panelWidth(700, 200), 240);
  assert.equal(panelLimits(1200).max, 480);
  for (const total of [650, 700, 900, 1400]) {
    assert.ok(total - panelWidth(total, 480) - 8 >= 320);
  }
});
test("split preference survives reload, isolates users, resets and rejects invalid values", () => {
  const stored = new Map();
  const window = new EventTarget();
  window.localStorage = {
    getItem: (key) => stored.get(key) ?? null,
    setItem: (key, value) => stored.set(key, value),
    removeItem: (key) => stored.delete(key),
  };
  const one = load("components/whatsapp/panel-width.ts", { window, Event });
  one.writePanelWidth("User-A", 420);
  const two = load("components/whatsapp/panel-width.ts", { window, Event });
  assert.equal(two.readPanelWidth("user-a"), 420);
  assert.equal(two.readPanelWidth("user-b"), null);
  two.writePanelWidth("User-A", null);
  assert.equal(two.readPanelWidth("user-a"), null);
  for (const value of ["NaN", "Infinity", "", "0", "999", "239"]) {
    stored.set("whatsgestor.panel-width.user-a", value);
    assert.equal(two.readPanelWidth("user-a"), null);
  }
});
test("blocked storage preserves temporary split choice and subscriptions clean up", () => {
  const window = new EventTarget();
  window.localStorage = {
    getItem() {
      throw Error();
    },
    setItem() {
      throw Error();
    },
    removeItem() {
      throw Error();
    },
  };
  const api = load("components/whatsapp/panel-width.ts", { window, Event });
  let calls = 0;
  const unsubscribe = api.subscribePanelWidth(() => calls++);
  api.writePanelWidth("a", 350);
  assert.equal(calls, 1);
  assert.equal(api.readPanelWidth("a"), 350);
  assert.equal(api.readPanelWidth("b"), null);
  unsubscribe();
  api.writePanelWidth("a", null);
  assert.equal(calls, 1);
  assert.equal(api.readPanelWidth("a"), null);
});
test("zoom and pan stay bounded for small, large and portrait images", () => {
  const { imageScale, imagePan } = load(
    "components/whatsapp/image-transform.ts",
  );
  assert.equal(imageScale(0.1), 1);
  assert.equal(imageScale(99), 8);
  assert.equal(imageScale(NaN), 1);
  assert.deepEqual(
    { ...imagePan(999, -999, 1, 100, 100, 600, 400) },
    { x: 0, y: 0 },
  );
  assert.deepEqual(
    { ...imagePan(999, -999, 4, 300, 200, 600, 400) },
    { x: 300, y: -200 },
  );
  assert.deepEqual(
    { ...imagePan(999, 999, 2, 200, 400, 600, 400) },
    { x: 0, y: 200 },
  );
});
