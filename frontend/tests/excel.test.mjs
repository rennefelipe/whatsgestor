import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
import ExcelJS from "exceljs";
const require = createRequire(import.meta.url);
function fixture() {
  const exports = {}, blobs = [];
  const source = ts.transpileModule(fs.readFileSync("services/excel.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  new Function("exports", "require", "Blob", "Uint8Array", "window", "URL", "document", source)(exports, require, Blob, Uint8Array,
    { setTimeout() {} }, { createObjectURL(blob) { blobs.push(blob); return "blob:test"; } }, { createElement() { return { click() {} }; } });

  return { api: exports, blobs };
}
async function file(headers, rows) {
  const workbook = new ExcelJS.Workbook(), sheet = workbook.addWorksheet("Cadastros");
  sheet.addRow(headers); for (const row of rows) sheet.addRow(row);
  return new File([await workbook.xlsx.writeBuffer()], "fixture.xlsx");
}
test("unified XLSX has exactly one Cadastros sheet, eight readable headers, no IDs, and preserves literal text on reimport", async () => {
  const f = fixture();
  const row = { Grupo: "AD", "Organização / Shopping": "Shopping Mogi", Loja: "=literal", Responsável: "José", WhatsApp: "+5511999991234", "Tipo de contato": "Lojista", "E-mail": "", Ativo: "Não", id: "private-id", token: "never-export" };
  await f.api.downloadExcel([row], "test.xlsx");
  const blob = f.blobs[0], workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(await blob.arrayBuffer());
  assert.equal(workbook.worksheets.length, 1); assert.equal(workbook.worksheets[0].name, "Cadastros");
  assert.equal(workbook.worksheets[0].columnCount, 8); assert.equal(workbook.worksheets[0].getCell("C2").value, "=literal");
  const parsed = await f.api.readExcel(new File([blob], "roundtrip.xlsx"));
  const expected = Object.fromEntries(f.api.registrationColumns.map(column => [column, row[column]]));
  assert.deepEqual(JSON.parse(JSON.stringify(parsed)), [expected]);
  assert.ok(!JSON.stringify(parsed).includes('private-id')); assert.ok(!JSON.stringify(parsed).includes('never-export'));
});
test("Excel model carries short header hints without extra tabs or fake data rows", async () => {
  const f = fixture(); await f.api.downloadExcel([], "modelo-cadastros.xlsx");
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(await f.blobs[0].arrayBuffer());
  assert.equal(workbook.worksheets.length, 1); assert.equal(workbook.worksheets[0].rowCount, 1);
  assert.ok(workbook.worksheets[0].getCell('E1').note);
});
test("Excel rejects missing or technical columns, formulas and extra sheets, and keeps blank line positions", async () => {
  const { api } = fixture();
  await assert.rejects(api.readExcel(await file(["Grupo"], [["AD"]])), /ausentes/);
  await assert.rejects(api.readExcel(await file(["ID"], [["technical"]])), /não reconhecida/);
  await assert.rejects(api.readExcel(await file(api.registrationColumns, [[{ formula: "1+1" }]])), /fórmulas/);
  const result = await api.readExcel(await file(api.registrationColumns, [["First"], [], ["Third"]]));
  assert.equal(result.length, 3); assert.equal(result[2].Grupo, "Third");
  const book = new ExcelJS.Workbook(); book.addWorksheet("Cadastros"); book.addWorksheet("Referências");
  await assert.rejects(api.readExcel(new File([await book.xlsx.writeBuffer()], "multiple.xlsx")), /única aba/);
});
test("an exported batch over the old 500-row limit remains compatible with the unified importer", async () => {
  const f = fixture();
  await f.api.downloadExcel(Array.from({ length: 550 }, (_, index) => ({ Grupo: 'Grupo ' + index })), 'larger.xlsx');
  const result = await f.api.readExcel(new File([f.blobs[0]], 'larger.xlsx'));
  assert.equal(result.length, 550); assert.equal(result[549].Grupo, 'Grupo 549');
});
