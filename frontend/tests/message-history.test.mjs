import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const exports = {};
vm.runInNewContext(
  ts.transpileModule(
    fs.readFileSync("components/whatsapp/message-history.ts", "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
      },
    },
  ).outputText,
  { exports },
);
function reader(total, calls) {
  return async (page) => {
    calls.push(page);
    return {
      page,
      pageSize: 50,
      total,
      items: Array.from(
        { length: Math.max(0, Math.min(50, total - (page - 1) * 50)) },
        (_, i) => ({ id: String((page - 1) * 50 + i + 1) }),
      ),
    };
  };
}
test("a partially filled latest page does not hide the recent message window", async () => {
  const result = await exports.loadRecentHistory(reader(101, []), 50);
  assert.equal(result.items.length, 51);
  assert.equal(result.items[0].id, "51");
  assert.equal(result.items.at(-1).id, "101");
  assert.equal(result.firstLoadedPage, 2);
});
test("polling across multiple page boundaries fills the gap without resetting older navigation", async () => {
  const result = await exports.loadRecentHistory(reader(210, []), 50, 2);
  assert.equal(result.items[0].id, "51");
  assert.equal(result.items.at(-1).id, "210");
  assert.equal(result.items.length, 160);
  assert.equal(Math.min(1, result.firstLoadedPage), 1);
});
test("concurrent changes and excessive catch-up never return an apparently complete history", async () => {
  let calls = 0;
  await assert.rejects(
    exports.loadRecentHistory(
      async (page) => reader(++calls === 1 ? 101 : 102, [])(page),
      50,
    ),
    /histórico mudou/,
  );
  await assert.rejects(
    exports.loadRecentHistory(reader(5000, []), 50, 1),
    /Reabra/,
  );
  const empty = await exports.loadRecentHistory(reader(0, []), 50);
  assert.equal(empty.items.length, 0);
});
