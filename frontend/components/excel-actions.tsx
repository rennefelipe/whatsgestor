"use client";
import { useEffect, useRef, useState } from "react";
import { ApiRequestError } from "@/services/api/client";
import { commitExchange, getExchangeExport, getExchangeStatus, previewExchange, type ExchangeFilters, type ExchangePreview, type ExchangeReport, type ExchangeSummary } from "@/services/api/data-exchange";
import { downloadExcel, readExcel, registrationColumns, type ExcelRow } from "@/services/excel";
import { Icon } from "./icons";

const actionLabels = { new: "Novo", existing: "Já existente", update: "Atualizar", error: "Revisar", empty: "Linha vazia" };
function Summary({ value }: { value: ExchangeSummary }) {
  const metrics: [string, number][] = [["Cadastros novos", value.newRecords], ["Já existentes", value.existingContacts + value.existingOrganizations], ["Serão atualizados", value.updatedContacts + value.updatedOrganizations], ["Contatos novos", value.newContacts], ["Grupos a criar", value.newGroups], ["Shoppings a criar", value.newShoppings], ["Outras organizações a criar", value.newOrganizations], ["Tipos de contato a criar", value.newContactTypes], ["Tipos de organização a criar", value.newOrganizationTypes], ["Linhas com erros ou conflitos", value.errorLines]];
  return <dl className="exchange-summary">{metrics.map(([label, count]) => <div key={label}><dt>{label}</dt><dd>{count}</dd></div>)}</dl>;
}
export function ExcelActions({ isAdmin, filters, standaloneTypes, onImported }: {
  isAdmin: boolean; filters: ExchangeFilters; standaloneTypes: { id: string; name: string }[]; onImported: () => void;
}) {
  const input = useRef<HTMLInputElement>(null), dialog = useRef<HTMLDialogElement>(null), lock = useRef(false);
  const lastPreviewId = useRef<string | undefined>(undefined);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [rows, setRows] = useState<ExcelRow[] | null>(null), [preview, setPreview] = useState<ExchangePreview | null>(null), [report, setReport] = useState<ExchangeReport | null>(null);
  const [uncertain, setUncertain] = useState(false), [standaloneTypeId, setStandaloneTypeId] = useState(""), [page, setPage] = useState(1);
  const open = rows !== null;
  useEffect(() => { if (!open) return; const element = dialog.current; element?.showModal(); return () => element?.close(); }, [open]);
  function close() { if (lock.current) return; setRows(null); setError(""); setPreview(null); setReport(null); }
  async function work(action: () => Promise<void>) {
    if (lock.current) return; lock.current = true; setBusy(true); setError("");
    try { await action(); } catch (error) { setError(error instanceof Error ? error.message : "Não foi possível concluir a operação."); }
    finally { lock.current = false; setBusy(false); }
  }
  async function validate(values: ExcelRow[]) {
    let result: ExchangePreview;
    try { result = await previewExchange(values, standaloneTypeId, lastPreviewId.current); }
    catch (error) {
      if (!lastPreviewId.current || !(error instanceof ApiRequestError) || ![404, 409].includes(error.status)) throw error;
      lastPreviewId.current = undefined;
      result = await previewExchange(values, standaloneTypeId);
    }
    lastPreviewId.current = result.id; setPreview(result);
  }
  async function commit() {
    if (!isAdmin || !preview?.canConfirm || !window.confirm(`Confirmar o lote? Serão criados ${preview.summary.newRecords} cadastros e atualizados ${preview.summary.updatedContacts + preview.summary.updatedOrganizations}. Nenhum registro será apagado e nenhum vínculo de contato será alterado.`)) return;
    try { const result = await commitExchange(preview.id); setReport(result); onImported(); }
    catch (error) {
      if (error instanceof ApiRequestError && error.code === "IMPORT_PREVIEW_CHANGED") setPreview(null);
      else if (!(error instanceof ApiRequestError) || error.status === 0 || error.status >= 500) setUncertain(true);
      throw error;
    }
  }
  const summary = report?.summary ?? preview?.summary;
  const pages = Math.max(1, Math.ceil((rows?.length ?? 0) / 50));
  return <>
    <div className="exchange-actions">
      <button className="secondary-button" type="button" disabled={busy} onClick={() => void work(async () => downloadExcel([], "modelo-cadastros.xlsx"))}>Baixar modelo Excel</button>
      <button className="primary-button" type="button" disabled={busy} onClick={() => input.current?.click()}><Icon name="plus" size={16} />Importar Excel</button>
      <button className="secondary-button" type="button" disabled={busy} onClick={() => void work(async () => { const result = await getExchangeExport(filters); await downloadExcel(result.rows); setNotice(`${result.rows.length} linhas exportadas. ${result.warnings.join(" ")}`); })}>Exportar Excel</button>
      <input ref={input} type="file" accept=".xlsx" className="sr-only" aria-label="Selecionar arquivo Excel" onChange={event => {
        const file = event.target.files?.[0]; event.target.value = "";
        if (file) void work(async () => {
          const values = await readExcel(file); lastPreviewId.current = undefined;
          setRows(values); setPreview(null); setReport(null); setUncertain(false); setPage(1); setNotice("");
          await validate(values);
        });
      }} />
    </div>
    {!isAdmin && <p className="recipient-notice">Você pode exportar e revisar a planilha. Somente administradores podem confirmar importações.</p>}
    {busy && <p role="status" className="recipient-help">Conferindo os cadastros…</p>}
    {notice && <p role="status" className="recipient-help">{notice}</p>}
    {error && !rows && <p className="inline-error" role="alert">{error}</p>}
    {rows && <dialog ref={dialog} className="modal excel-review-modal exchange-review" role="dialog" aria-modal="true" aria-labelledby="excel-title" onCancel={event => { event.preventDefault(); close(); }}>
      <header className="modal-header"><div><h2 id="excel-title">{report ? "Importação concluída" : "Revisar Cadastros"}</h2><p>{report ? `${report.imported} cadastros criados · ${report.updated} atualizados · ${report.existing} reutilizados` : `${rows.length} ${rows.length === 1 ? 'linha' : 'linhas'} · confira as ações antes de confirmar`}</p></div><button autoFocus type="button" className="icon-button" disabled={busy} aria-label="Fechar importação" onClick={close}><Icon name="close" /></button></header>
      <div className="modal-body">
        {!isAdmin && <p className="recipient-notice">Somente administradores podem confirmar este lote.</p>}
        {error && <p className="inline-error" role="alert">{error}</p>}
        {uncertain && <p className="recipient-notice">O resultado da confirmação não pôde ser garantido. Consulte o relatório e confira os cadastros antes de preparar outro lote. Não repita a confirmação.</p>}
        {summary && <Summary value={summary} />}
        {!report && <>
          <p className="recipient-help">Nomes são comparados sem diferenciar maiúsculas e espaços excedentes. Campos vazios de e-mail e situação preservam valores já cadastrados. Corrija ou retire do lote todas as linhas com conflito antes de confirmar.</p>
          <label className="form-field exchange-type-choice">Tipo para novas organizações sem grupo <select disabled={busy || uncertain} value={standaloneTypeId} onChange={event => { setStandaloneTypeId(event.target.value); setPreview(null); }}><option value="">Revisar quando o tipo não puder ser identificado</option>{standaloneTypes.map(type => <option value={type.id} key={type.id}>{type.name}</option>)}</select></label>
          <p className="recipient-help">Essa escolha só vale para organizações novas sem grupo. Cadastros existentes mantêm seus tipos e sua hierarquia.</p>
        </>}
        {preview?.summary.errorLines ? <p role="alert" className="form-error">Há {preview.summary.errorLines} linhas com erro ou conflito. Nenhum cadastro será gravado enquanto houver pendências.</p> : null}
        <div className="contact-table-scroll"><table className="excel-review-table"><thead><tr><th>Linha</th>{registrationColumns.map(column => <th key={column}>{column}</th>)}<th>Ações previstas / resultado</th>{!report && <th>Revisão</th>}</tr></thead><tbody>
          {rows.slice((page - 1) * 50, page * 50).map((row, offset) => {
            const index = (page - 1) * 50 + offset, review = report?.rows[index] ?? preview?.rows[index];
            return <tr key={index}><td>{index + 2}</td>{registrationColumns.map(column => <td key={column}>{report ? row[column] || '—' : <input aria-label={`${column}, linha ${index + 2}`} disabled={busy || uncertain} value={row[column] ?? ""} onChange={event => { setRows(current => current!.map((value, number) => number === index ? { ...value, [column]: event.target.value } : value)); setPreview(null); }} />}</td>)}
              <td className="exchange-row-review">{review ? <><strong className={review.issues.length ? 'exchange-error-label' : ''}>{actionLabels[review.action]}</strong>{review.actions.map((action, number) => <p key={number}>{action}</p>)}{review.issues.map((issue, number) => <p role="status" className="exchange-error-label" key={number}>{issue}</p>)}</> : "Valide as alterações para revisar as ações."}</td>
              {!report && <td><button type="button" className="secondary-button" disabled={busy || uncertain} aria-label={`Retirar linha ${index + 2} do lote`} onClick={() => { setRows(current => current!.filter((_, number) => number !== index)); setPreview(null); setPage(current => Math.max(1, Math.min(current, Math.ceil((rows.length - 1) / 50)))); }}>Retirar do lote</button></td>}
            </tr>;
          })}
        </tbody></table></div>
        <div className="results-summary"><button type="button" className="secondary-button" disabled={busy || page === 1} onClick={() => setPage(value => value - 1)}>Anterior</button><span>Página {page} de {pages}</span><button type="button" className="secondary-button" disabled={busy || page >= pages} onClick={() => setPage(value => value + 1)}>Próxima</button></div>
      </div>
      <footer className="modal-footer"><button type="button" className="secondary-button" disabled={busy} onClick={close}>Fechar</button>
        {!report && !uncertain && <><button type="button" className="secondary-button" disabled={busy || !!preview || !rows.length} onClick={() => void work(async () => validate(rows))}>Validar alterações</button><button type="button" className="primary-button" disabled={busy || !isAdmin || !preview?.canConfirm} onClick={() => void work(commit)}>Confirmar importação</button></>}
        {uncertain && !report && preview && <button type="button" className="secondary-button" disabled={busy} onClick={() => void work(async () => { const result = await getExchangeStatus(preview.id); if (result.result) { setReport(result.result); onImported(); } else throw new Error(`Situação: ${result.state}. Confira os cadastros antes de preparar outro lote.`); })}>Consultar relatório</button>}
      </footer>
    </dialog>}
  </>;
}
