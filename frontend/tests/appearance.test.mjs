import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import postcss from "postcss";

const compiled = ts.transpileModule(
  fs.readFileSync("components/appearance/theme-storage.ts", "utf8"),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2017,
    },
  },
).outputText;
function storage() {
  const data = new Map();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
    removeItem: (key) => data.delete(key),
  };
}
function environment(localStorage = storage()) {
  const window = new EventTarget();
  Object.assign(window, {
    localStorage,
    sessionStorage: storage(),
    atob: (value) => Buffer.from(value, "base64").toString("binary"),
  });
  const document = { documentElement: { dataset: {} } };
  const exports = {};
  const context = vm.createContext({ window, document, Event, exports });
  vm.runInContext(compiled, context);
  return { window, document, api: exports, context };
}
function session(env, sub) {
  env.window.sessionStorage.setItem(
    "whatsgestor.accessToken",
    "header." +
      Buffer.from(JSON.stringify({ sub })).toString("base64url") +
      ".signature",
  );
}
function boot(env) {
  vm.runInContext(env.api.THEME_BOOTSTRAP_SCRIPT, env.context);
  return env.document.documentElement.dataset.theme;
}

test("three themes persist per authenticated user and restore before paint after F5", () => {
  const shared = storage();
  for (const theme of ["white", "gray", "dark"]) {
    const env = environment(shared);
    assert.equal(env.api.writeTheme("USER-A", theme), true);
    assert.equal(env.api.readTheme("user-a"), theme);
    const refreshed = environment(shared);
    session(refreshed, "USER-A");
    assert.equal(boot(refreshed), theme);
  }
});
test("account changes and public login appearance do not overwrite other accounts", () => {
  const env = environment();
  env.api.writeTheme("user-a", "dark");
  env.api.writeTheme("user-b", "gray");
  env.api.writeTheme(env.api.PUBLIC_THEME_ID, "gray");
  assert.equal(env.api.readTheme("user-a"), "dark");
  assert.equal(env.api.readTheme("user-b"), "gray");
  session(env, "user-a");
  assert.equal(boot(env), "dark");
  session(env, "user-b");
  assert.equal(boot(env), "gray");
  session(env, "user-c");
  assert.equal(boot(env), "white");
  env.window.sessionStorage.removeItem("whatsgestor.accessToken");
  assert.equal(boot(env), "gray");
});
test("invalid saved preferences and invalid session hints use a safe theme", () => {
  const env = environment();
  env.window.localStorage.setItem(env.api.themeKey("user"), "invalid");
  session(env, "user");
  assert.equal(boot(env), "white");
  assert.equal(env.api.readTheme("user"), "white");
  env.window.sessionStorage.setItem("whatsgestor.accessToken", "malformed");
  assert.equal(boot(env), "white");
});
test("disabled storage permits a temporary theme and reports lack of persistence", () => {
  const env = environment({
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("blocked");
    },
  });
  assert.equal(env.api.writeTheme("user", "dark"), false);
  assert.equal(env.api.readTheme("user"), "dark");
  assert.equal(boot(env), "white");
});
test("appearance changes notify subscribers without authentication or API calls", () => {
  const env = environment();
  let notifications = 0;
  const unsubscribe = env.api.subscribeToTheme(() => notifications++);
  env.api.writeTheme("user", "gray");
  assert.equal(notifications, 1);
  unsubscribe();
  env.api.writeTheme("user", "white");
  assert.equal(notifications, 1);
});

const globals = postcss.parse(fs.readFileSync("app/globals.css", "utf8"));
const themed = postcss.parse(fs.readFileSync("app/themes.css", "utf8"));
test("all existing screens use semantic colors and all referenced tokens exist", () => {
  const defined = new Set();
  for (const sheet of [globals, themed])
    sheet.walkDecls((decl) => {
      if (decl.prop.startsWith("--")) defined.add(decl.prop);
    });
  globals.walkDecls((decl) => {
    assert.doesNotMatch(
      decl.value,
      /#[\da-f]{3,8}\b|\b(?:white|black)\b(?!-)/i,
      decl.parent.selector + ": " + decl.prop,
    );
  });
  for (const sheet of [globals, themed])
    sheet.walkDecls((decl) => {
      for (const match of decl.value.matchAll(/var\((--[\w-]+)/g))
        assert.ok(defined.has(match[1]), "undefined " + match[1]);
    });
});
function luminance(hex) {
  const rgb = hex
    .slice(1)
    .match(/../g)
    .map((part) => parseInt(part, 16) / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}
function ratio(a, b) {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + 0.05) / (values[1] + 0.05);
}
for (const theme of ["white", "gray", "dark"])
  test("text contrast in " + theme + " theme is at least 4.5:1", () => {
    const tokens = {};
    themed.walkRules((rule) => {
      if (rule.selector.includes('data-theme="' + theme + '"'))
        rule.walkDecls((decl) => {
          tokens[decl.prop] = decl.value;
        });
    });
    function resolve(key) {
      const value = tokens[key];
      const alias = /^var\((--[\w-]+)\)$/.exec(value);
      return alias ? resolve(alias[1]) : value;
    }
    const pairs = [];
    for (const surface of [
      "canvas",
      "surface",
      "surface-muted",
      "surface-hover",
      "history-bg",
    ])
      for (const text of ["text-primary", "text-muted"])
        pairs.push([text, surface]);
    pairs.push(
      ["on-brand", "brand"],
      ["on-brand", "brand-hover"],
      ["brand-text", "brand-soft"],
      ["text-primary", "message-sent-bg"],
      ["hero-text", "hero-start"],
      ["hero-text", "hero-middle"],
      ["hero-text", "hero-end"],
      ["qr-ink", "qr-surface"],
    );
    for (const state of ["waiting", "info", "success", "neutral"])
      pairs.push(
        [state + "-text", state + "-bg"],
        [state + "-text", state + "-selected"],
      );
    pairs.push(
      ["danger-text", "danger-bg"],
      ["error-banner-text", "error-banner-bg"],
      ["on-error", "error-accent"],
    );
    for (const state of ["all", "waiting", "in_progress", "finished"])
      pairs.push(
        ["status-" + state + "-text", "status-" + state + "-bg"],
        ["status-" + state + "-text", "status-" + state + "-selected"],
      );
    const componentPairs = [];
    for (const surface of [
      "surface",
      "canvas",
      "surface-muted",
      "surface-hover",
    ])
      componentPairs.push(["focus", surface], ["control-border", surface]);
    for (const state of ["all", "waiting", "in_progress", "finished"])
      componentPairs.push(["status-" + state + "-border", "surface"]);
    componentPairs.push(["error-banner-border", "surface"]);
    for (const [foreground, background] of componentPairs)
      assert.ok(
        ratio(resolve("--" + foreground), resolve("--" + background)) >= 3,
        theme + " component " + foreground + "/" + background,
      );
    for (const [text, background] of pairs)
      assert.ok(
        ratio(resolve("--" + text), resolve("--" + background)) >= 4.5,
        theme +
          " " +
          text +
          "/" +
          background +
          ": " +
          ratio(resolve("--" + text), resolve("--" + background)).toFixed(2),
      );
  });
