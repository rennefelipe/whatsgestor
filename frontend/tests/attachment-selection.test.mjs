import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
function module(file, globals = {}) {
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync(file, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
    { exports, ...globals },
  );
  return exports;
}
const {
  validateAttachmentSelection,
  formatAttachmentSize,
  createAttachmentAttemptId,
} = module("components/whatsapp/attachment-selection.ts");
test("attempt IDs remain valid UUIDs when randomUUID is unavailable on an HTTP origin, and refuse weak randomness", () => {
  let calls = 0;
  const id = createAttachmentAttemptId({
    getRandomValues: (bytes) => {
      calls++;
      for (let index = 0; index < bytes.length; index++) bytes[index] = index;
      return bytes;
    },
  });
  assert.match(
    id,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  assert.equal(calls, 1);
  assert.throws(() => createAttachmentAttemptId({}), /randomness unavailable/);
});
test("small attachments show their nonzero byte size instead of rounded zero MB", () => {
  assert.equal(formatAttachmentSize(91), "91 B");
  assert.equal(formatAttachmentSize(1024), "1 KB");
  assert.equal(formatAttachmentSize(1048576), "1 MB");
});
test("selects JPEG/PNG/WebP/PDF with independent extension, MIME and size checks", () => {
  for (const [extension, type, limit] of [
    ["jpg", "image/jpeg", 5],
    ["jpeg", "image/jpeg", 5],
    ["png", "image/png", 5],
    ["webp", "image/webp", 5],
    ["pdf", "application/pdf", 20],
  ]) {
    assert.equal(
      validateAttachmentSelection({
        name: `teste.${extension}`,
        type,
        size: limit * 1024 * 1024,
      }),
      null,
    );
    assert.ok(
      validateAttachmentSelection({
        name: `teste.${extension}`,
        type,
        size: limit * 1024 * 1024 + 1,
      }),
    );
  }
  for (const file of [
    { name: "empty.pdf", type: "application/pdf", size: 0 },
    { name: "bad.exe", type: "image/jpeg", size: 12 },
    { name: "fake.png", type: "application/pdf", size: 12 },
    { name: "no-type.jpg", type: "", size: 12 },
  ])
    assert.ok(validateAttachmentSelection(file));
});
test("multipart uses the existing bearer token with a browser-generated boundary, without a JSON content type or token URL", async () => {
  const body = new FormData();
  body.append(
    "file",
    new Blob(["synthetic"], { type: "image/png" }),
    "teste.png",
  );
  const api = module("services/api/client.ts", {
    FormData,
    process: { env: {} },
    require: () => ({
      getAccessToken: () => "synthetic-token",
      notifyAuthenticationExpired: () => {
        throw Error("Unexpected expiration");
      },
    }),
    fetch: async (url, init) => {
      assert.equal(url, "http://localhost:3001/attachments");
      assert.equal(init.body, body);
      assert.equal(init.headers.Authorization, "Bearer synthetic-token");
      assert.equal(init.headers["Content-Type"], undefined);
      assert.equal(init.headers["Idempotency-Key"], "synthetic-attempt");
      return {
        ok: true,
        status: 201,
        text: async () => JSON.stringify({ id: "confirmed" }),
      };
    },
  });
  assert.equal(
    (
      await api.apiRequest("/attachments", {
        method: "POST",
        body,
        headers: { "Idempotency-Key": "synthetic-attempt" },
      })
    ).id,
    "confirmed",
  );
});
