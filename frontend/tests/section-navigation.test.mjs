import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function fixture(hash = "") {
  const window = new EventTarget();
  const history = [hash];
  Object.assign(window, {
    location: { hash },
    history: {
      pushState: (_state, _title, value) => {
        window.location.hash = value;
        history.push(value);
      },
    },
  });
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(
      fs.readFileSync("components/section-navigation.ts", "utf8"),
      {
        compilerOptions: { module: ts.ModuleKind.CommonJS },
      },
    ).outputText,
    { exports, window, Event },
  );
  return { api: exports, window, history };
}

test("authenticated root defaults to Conversations and a refresh preserves every section", () => {
  assert.equal(fixture().api.readSection(), "conversations");
  for (const section of [
    "users",
    "contacts",
    "settings",
    "conversations",
    "bulk-send",
    "whatsapp-connections",
    "whatsapp-monitor",
    "organizations",
    "organization-types",
    "contact-types",
    "contact-identification",
    "appearance",
    "automatic-messages",
    "data-exchange",
  ]) {
    const f = fixture();
    f.api.writeSection(section);
    assert.equal(fixture(f.window.location.hash).api.readSection(), section);
  }
  assert.equal(fixture("#unknown").api.readSection(), "conversations");
});

test("navigation reacts to history and cleans up subscriptions without changing auth storage", () => {
  const f = fixture();
  let updates = 0;
  const unsubscribe = f.api.subscribeSection(() => updates++);
  f.api.writeSection("contacts");
  assert.equal(f.api.readSection(), "contacts");
  f.window.location.hash = "#settings";
  f.window.dispatchEvent(new Event("popstate"));
  assert.equal(f.api.readSection(), "settings");
  assert.equal(updates, 2);
  unsubscribe();
  f.window.dispatchEvent(new Event("hashchange"));
  assert.equal(updates, 2);
});
