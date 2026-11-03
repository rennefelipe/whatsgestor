export type ExcelRow = Record<string, string>;
export const registrationColumns = ["Grupo", "Organização / Shopping", "Loja", "Responsável", "WhatsApp", "Tipo de contato", "E-mail", "Ativo"] as const;

export async function readExcel(file: File): Promise<ExcelRow[]> {
  if (!file.name.toLowerCase().endsWith(".xlsx")) throw new Error("Selecione um arquivo .xlsx.");
  if (!file.size || file.size > 8 * 1024 * 1024) throw new Error("O arquivo deve ter até 8 MB.");
  const { Workbook } = await import("exceljs");
  const workbook = new Workbook();
  await workbook.xlsx.load(await file.arrayBuffer());
  const sheet = workbook.getWorksheet("Cadastros");
  if (!sheet || workbook.worksheets.length !== 1) throw new Error("Use uma única aba chamada Cadastros. Baixe o modelo atual, sem IDs ou abas de referência.");
  if (sheet.rowCount > 10001 || sheet.columnCount > 30) throw new Error("Limite de 10.000 linhas por arquivo. Nenhum registro será importado parcialmente.");
  const headers = new Map<number, string>();
  sheet.getRow(1).eachCell((cell, column) => {
    if (typeof cell.value !== "string") throw new Error("Os cabeçalhos devem ser textos.");
    const name = cell.value.trim().replace(/\s+/gu, " ");
    if (!registrationColumns.includes(name as typeof registrationColumns[number])) throw new Error(`Coluna não reconhecida: ${name}. Use as oito colunas do modelo atual.`);
    if ([...headers.values()].includes(name)) throw new Error(`Coluna repetida: ${name}.`);
    headers.set(column, name);
  });
  const missing = registrationColumns.filter(name => ![...headers.values()].includes(name));
  if (missing.length) throw new Error(`Cabeçalhos ausentes: ${missing.join(", ")}. Campos opcionais podem ficar vazios.`);
  const rows: ExcelRow[] = [];
  for (let number = 2; number <= sheet.rowCount; number++) {
    const values: ExcelRow = {};
    for (const [column, header] of headers) {
      const value = sheet.getRow(number).getCell(column).value;
      if (value !== null && value !== undefined && typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") throw new Error(`Linha ${number}: fórmulas, links e objetos não são aceitos. Cole apenas os valores.`);
      if (typeof value === "number" && !Number.isSafeInteger(value)) throw new Error(`Linha ${number}: use texto para preservar o número informado.`);
      values[header] = value === null || value === undefined ? "" : String(value);
    }
    rows.push(values);
  }
  while (rows.length && !Object.values(rows[rows.length - 1]).some(value => value.trim())) rows.pop();
  if (!rows.length) throw new Error("A aba Cadastros não contém registros.");
  return rows;
}

export async function downloadExcel(rows: ExcelRow[], filename = "cadastros.xlsx") {
  if (rows.length > 10000) throw new Error("Refine os filtros para exportar até 10.000 linhas por arquivo.");
  const { Workbook } = await import("exceljs");
  const workbook = new Workbook(); workbook.creator = "WhatsGestor";
  const sheet = workbook.addWorksheet("Cadastros");
  sheet.columns = registrationColumns.map(header => ({ header, key: header, width: header === "Organização / Shopping" || header === "E-mail" ? 34 : header === "Ativo" ? 12 : 24 }));
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F766E" } };
  sheet.getRow(1).height = 25;
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: registrationColumns.length } };
  const hints = ["Nome do grupo. Deixe vazio se não houver grupo.", "Nome da organização ou shopping. Para criar shopping, informe seu grupo.", "Nome da loja, opcional. Não cria uma entidade separada.", "Nome do responsável. Deixe os campos de contato vazios para cadastrar somente organização.", "DDD e número ou formato internacional, por exemplo 11999991234.", "Nome da função ou classificação, por exemplo Lojista.", "E-mail opcional. Vazio preserva o e-mail já cadastrado.", "Sim ou Não. Vazio preserva a situação existente; novos registros começam ativos."];
  registrationColumns.forEach((_, index) => { sheet.getCell(1, index + 1).note = hints[index]; });
  // Only the eight public columns are written, always as literal text.
  for (const record of rows) sheet.addRow(registrationColumns.map(column => record[column] ?? "")).numFmt = "@";
  const data = await workbook.xlsx.writeBuffer();
  if (data.byteLength > 8 * 1024 * 1024) throw new Error("O arquivo excederia 8 MB. Refine os filtros para preservar a compatibilidade com a importação.");
  const url = URL.createObjectURL(new Blob([new Uint8Array(data)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const link = document.createElement("a"); link.href = url; link.download = filename; link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
