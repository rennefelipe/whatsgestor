import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const exports = {};
vm.runInNewContext(
  ts.transpileModule(
    fs.readFileSync("components/whatsapp/message-scroll.ts", "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
      },
    },
  ).outputText,
  { exports },
);
const { MessageScrollController } = exports;

function fixture(count = 40) {
  const heights = Array(count).fill(60);
  let top = 0;
  let prefix = 0;
  let writes = 0;
  let visible = false;
  const elements = heights.map((_, index) => ({
    isConnected: true,
    getBoundingClientRect: () => {
      const offset =
        prefix + heights.slice(0, index).reduce((a, b) => a + b, 0) - top;
      return { top: offset, bottom: offset + heights[index] };
    },
  }));
  const viewport = {
    clientHeight: 300,
    get scrollHeight() {
      return prefix + heights.reduce((a, b) => a + b, 0);
    },
    get scrollTop() {
      return top;
    },
    set scrollTop(value) {
      writes++;
      top = Math.max(0, Math.min(value, this.scrollHeight - this.clientHeight));
    },
    getBoundingClientRect: () => ({ top: 0, bottom: 300 }),
    querySelectorAll: () => elements,
    contains: (element) => elements.includes(element),
  };
  const controller = new MessageScrollController(viewport, (value) => {
    visible = value;
  });
  const add = () => {
    heights.push(60);
    const i = heights.length - 1;
    elements.push({
      isConnected: true,
      getBoundingClientRect: () => ({
        top: prefix + heights.slice(0, i).reduce((a, b) => a + b, 0) - top,
        bottom:
          prefix + heights.slice(0, i + 1).reduce((a, b) => a + b, 0) - top,
      }),
    });
  };
  return {
    controller,
    viewport,
    heights,
    elements,
    add,
    prepend: (height) => {
      prefix += height;
    },
    visible: () => visible,
    writes: () => writes,
  };
}

test("opening a long history and reopening after F5 starts at the latest message", () => {
  for (let i = 0; i < 2; i++) {
    const f = fixture();
    f.controller.update("last", false);
    assert.equal(f.viewport.scrollTop, 2100);
    assert.equal(f.visible(), false);
  }
});
test("switching conversations resets following to the new history", () => {
  const first = fixture();
  first.controller.update("a", false);
  first.viewport.scrollTop = 600;
  first.controller.onScroll();
  const next = fixture(80);
  next.controller.update("b", false);
  assert.equal(next.viewport.scrollTop, 4500);
});
test("new incoming messages follow when the reader is near the end", () => {
  const f = fixture();
  f.controller.update("last", false);
  f.viewport.scrollTop -= 60;
  f.controller.onScroll();
  f.add();
  f.controller.update("new", false);
  assert.equal(f.viewport.scrollTop, 2160);
});
test("polling with identical messages does not snap a reader who is near the end", () => {
  const f = fixture();
  f.controller.update("last", false);
  f.viewport.scrollTop -= 60;
  f.controller.onScroll();
  const writes = f.writes();
  f.controller.update("last", false);
  f.controller.reconcile();
  assert.equal(f.viewport.scrollTop, 2040);
  assert.equal(f.writes(), writes);
  assert.equal(f.visible(), true);
});
test("incoming messages preserve old reading position and expose the latest-message control", () => {
  const f = fixture();
  f.controller.update("last", false);
  f.viewport.scrollTop = 600;
  f.controller.onScroll();
  f.add();
  f.controller.update("new", false);
  assert.equal(f.viewport.scrollTop, 600);
  assert.equal(f.visible(), true);
  f.controller.latest();
  assert.equal(f.viewport.scrollTop, 2160);
  assert.equal(f.visible(), false);
});
test("successful outgoing message follows even while the reader is consulting older messages", () => {
  const f = fixture();
  f.controller.update("last", false);
  f.viewport.scrollTop = 600;
  f.controller.onScroll();
  f.controller.followSentMessage();
  f.add();
  f.controller.update("sent", false);
  assert.equal(f.viewport.scrollTop, 2160);
});
test("image growth above the visible anchor preserves its screen position", () => {
  const f = fixture();
  f.controller.update("last", false);
  f.viewport.scrollTop = 600;
  f.controller.onScroll();
  f.heights[0] += 200;
  f.controller.reconcile();
  assert.equal(f.viewport.scrollTop, 800);
});
test("media growth while following stays at the end", () => {
  const f = fixture();
  f.controller.update("last", false);
  f.heights[0] += 200;
  f.controller.reconcile();
  assert.equal(f.viewport.scrollTop, 2300);
});
test("prepending older history preserves the first visible message", () => {
  const f = fixture();
  f.controller.update("last", false);
  f.viewport.scrollTop = 0;
  f.controller.onScroll();
  f.controller.preserveOlderMessages();
  f.prepend(600);
  f.controller.update("last", false);
  assert.equal(f.viewport.scrollTop, 600);
});
test("hidden panels do not lose the pending initial scroll", () => {
  const f = fixture();
  f.viewport.clientHeight = 0;
  f.controller.update("last", false);
  assert.equal(f.viewport.scrollTop, 0);
  f.viewport.clientHeight = 300;
  f.controller.reconcile();
  assert.equal(f.viewport.scrollTop, 2100);
});
