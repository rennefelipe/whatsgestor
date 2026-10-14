import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function client(fetch) {
  let expired = 0;
  const exports = {};
  const source = ts.transpileModule(
    fs.readFileSync("services/api/client.ts", "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  vm.runInNewContext(source, {
    exports,
    process: { env: {} },
    fetch,
    require: (name) => {
      assert.equal(name, "./auth-session");
      return {
        getAccessToken: () => "test-session-token",
        notifyAuthenticationExpired: () => expired++,
      };
    },
  });
  return { api: exports, expired: () => expired };
}
test("binary media fetch uses existing bearer session, no public URL token and no JSON headers", async () => {
  const blob = new Blob(["%PDF-1.7"], { type: "application/pdf" });
  const env = client(async (url, init) => {
    assert.equal(
      url,
      "http://localhost:3001/whatsapp-conversations/conversation/messages/message/media",
    );
    assert.equal(init.headers.Authorization, "Bearer test-session-token");
    assert.equal(init.headers["Content-Type"], undefined);
    assert.equal(init.cache, "no-store");
    return { ok: true, status: 200, blob: () => Promise.resolve(blob) };
  });
  assert.equal(
    await env.api.apiBlob(
      "/whatsapp-conversations/conversation/messages/message/media",
    ),
    blob,
  );
});
test("expired session uses existing authentication-expiration notification", async () => {
  const env = client(async () => ({ ok: false, status: 401 }));
  await assert.rejects(
    env.api.apiBlob("/media"),
    (error) => error.status === 401,
  );
  assert.equal(env.expired(), 1);
});
test("media access failures do not become playable blobs", async () => {
  const env = client(async () => ({ ok: false, status: 404 }));
  await assert.rejects(
    env.api.apiBlob("/media"),
    (error) => error.status === 404,
  );
});
test("cancelled history downloads retain cancellation and do not expire the session", async () => {
  const controller = new AbortController();
  controller.abort();
  const failure = new Error("cancelled");
  const env = client(() => Promise.reject(failure));
  await assert.rejects(
    env.api.apiBlob("/media", controller.signal),
    (error) => error === failure,
  );
  assert.equal(env.expired(), 0);
});

test("JSON network errors preserve Portuguese accents and do not expire authentication", async () => {
  const env = client(() => Promise.reject(new Error("network")));
  await assert.rejects(env.api.apiRequest("/auth/me"), (error) => {
    assert.equal(error.status, 0);
    assert.equal(
      error.message,
      "Não foi possível conectar à API. Verifique se o backend está em execução.",
    );
    return true;
  });
  assert.equal(env.expired(), 0);
});
for (const [status, path, expected, expires] of [
  [401, "/auth/login", "Usuário ou senha inválidos.", 0],
  [401, "/auth/me", "Sessão expirada ou inválida. Entre novamente.", 1],
  [403, "/contacts", "Você não tem permissão para realizar esta operação.", 0],
  [
    503,
    "/auth/me",
    "A API está temporariamente indisponível. Tente novamente em instantes.",
    0,
  ],
])
  test(`JSON status ${status} on ${path} is classified without changing session rules`, async () => {
    for (const body of ["", "<html>Unavailable</html>"]) {
      const env = client(async () => ({
        ok: false,
        status,
        text: () => Promise.resolve(body),
      }));
      await assert.rejects(
        env.api.apiRequest(path),
        (error) => error.status === status && error.message === expected,
      );
      assert.equal(env.expired(), expires);
    }
  });
test("valid API error payloads retain their original meaning", async () => {
  const message = "O contato informado não existe ou está inativo.";
  const env = client(async () => ({
    ok: false,
    status: 400,
    text: () => Promise.resolve(JSON.stringify({ message })),
  }));
  await assert.rejects(
    env.api.apiRequest("/contacts"),
    (error) => error.message === message && error.status === 400,
  );
  assert.equal(env.expired(), 0);
});
