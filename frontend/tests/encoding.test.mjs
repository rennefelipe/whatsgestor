import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function files(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filename = path.join(directory, entry.name);
    return entry.isDirectory()
      ? files(filename)
      : /\.(?:tsx?|css)$/.test(filename)
        ? [filename]
        : [];
  });
}
test("frontend and backend source files remain valid UTF-8 without corrupted text", () => {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const sources = [
    "app",
    "components",
    "services",
    "types",
    "../backend/src",
  ].flatMap(files);
  assert.ok(sources.length > 100);
  for (const filename of sources) {
    const text = decoder.decode(fs.readFileSync(filename));
    assert.doesNotMatch(
      text,
      /\u00c3[\u0080-\u00bf]|\u00c2[\u0080-\u00bf]|\ufffd|\u00e2[\u0080\u20ac\u201a\u201e]/,
      filename,
    );
  }
});
