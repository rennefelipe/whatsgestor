"use client";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { apiRequest } from "@/services/api/client";
import { Icon } from "../icons";

type EventName = "waiting" | "started" | "transferred" | "finished";
interface Template { id: string; name: string; event: EventName; text: string; isActive: boolean; version: number }
const labels: Record<EventName, string> = { waiting: "Aguardando atendimento", started: "Atendimento iniciado", transferred: "Atendimento transferido", finished: "Atendimento finalizado" };
const empty = { id: "", name: "", event: "waiting" as EventName, text: "", isActive: false, version: 0 };

export function AutomaticMessagesScreen() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [draft, setDraft] = useState<Template | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    try { const result = await apiRequest<{ templates: Template[] }>("/automatic-messages"); setTemplates(result.templates); setError(""); }
    catch (error) { setError(error instanceof Error ? error.message : "Não foi possível carregar os modelos."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { let cancelled = false; void Promise.resolve().then(() => { if (!cancelled) void load(); }); return () => { cancelled = true; }; }, [load]);
  async function save(event: FormEvent) {
    event.preventDefault(); if (!draft || busy) return;
    setBusy(true); setError("");
    try {
      const { id, ...payload } = draft;
      await apiRequest(`/automatic-messages${id ? `/${id}` : ""}`, { method: id ? "PUT" : "POST", body: JSON.stringify(payload) });
      setDraft(null); await load(); setNotice("Modelo salvo. O envio automático continua desabilitado.");
    } catch (error) { setError(error instanceof Error ? error.message : "Falha ao salvar."); }
    finally { setBusy(false); }
  }
  async function remove(template: Template) {
    if (!window.confirm(`Excluir o modelo “${template.name}”?`)) return;
    setBusy(true);
    try { await apiRequest(`/automatic-messages/${template.id}`, { method: "DELETE", body: JSON.stringify({ version: template.version }) }); await load(); }
    catch (error) { setError(error instanceof Error ? error.message : "Falha ao excluir."); }
    finally { setBusy(false); }
  }
  return <main className="main-content">
    <div className="page-heading"><div><p className="eyebrow">Relacionamento em cada etapa</p><h1>Mensagens automáticas</h1><p className="page-subtitle">Prepare os modelos usados nos eventos de atendimento.</p></div><button className="primary-button" disabled={busy || loading} onClick={() => { setError(""); setDraft({ ...empty }); }}><Icon name="plus" size={16} />Novo modelo</button></div>
    <div className="recipient-notice" role="status"><strong>Envio automático desabilitado.</strong> Você pode cadastrar e ativar modelos para revisão. Nenhuma mensagem será enviada até a liberação dos disparos.</div>
    {error && <p className="inline-error" role="alert">{error} <button type="button" className="secondary-button" disabled={busy} onClick={() => void load()}>Atualizar</button></p>}
    {notice && <p role="status" className="recipient-help">{notice}</p>}
    {loading ? <p role="status">Carregando modelos…</p> : <div className="settings-card-grid">{templates.map(template => <article className="automatic-template-card" key={template.id}><div className="results-summary"><span className={`status-pill ${template.isActive ? "active" : "inactive"}`}>{template.isActive ? "Modelo ativo" : "Modelo inativo"}</span><span>{labels[template.event]}</span></div><h2>{template.name}</h2><p className="template-preview">{template.text.replaceAll("{atendente}", "Maria (exemplo)")}</p><div className="recipient-actions"><button type="button" className="secondary-button" disabled={busy} onClick={() => { setError(""); setDraft({ ...template }); }}><Icon name="edit" size={15} />Editar modelo</button><button type="button" className="secondary-button" title={template.isActive ? "Desative o modelo antes de excluir" : "Excluir modelo"} disabled={busy || template.isActive} onClick={() => void remove(template)}>Excluir</button></div></article>)}</div>}
    {draft && <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="template-title"><header className="modal-header"><h2 id="template-title">{draft.id ? "Editar modelo" : "Novo modelo"}</h2><button type="button" className="icon-button" aria-label="Fechar modelo" disabled={busy} onClick={() => setDraft(null)}><Icon name="close" /></button></header><form onSubmit={save}><div className="modal-body">
      {error && <p className="form-error" role="alert">{error}</p>}
      <label className="form-field">Nome<input autoFocus required maxLength={100} value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} /></label>
      <label className="form-field">Evento<select value={draft.event} onChange={event => setDraft({ ...draft, event: event.target.value as EventName })}>{Object.entries(labels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
      <label className="form-field">Texto<textarea required rows={5} maxLength={2000} value={draft.text} onChange={event => setDraft({ ...draft, text: event.target.value })} /></label><p className="form-help">Variável disponível: {"{atendente}"}. Substituída pelo nome do responsável.</p>
      <label className="visibility-toggle"><input type="checkbox" checked={draft.isActive} onChange={event => setDraft({ ...draft, isActive: event.target.checked })} />Modelo ativo para revisão</label>
      <div className="organization-context-card"><strong>Prévia</strong><p className="template-preview">{draft.text.replaceAll("{atendente}", "Maria (exemplo)") || "Digite o texto para visualizar."}</p></div>
    </div><footer className="modal-footer"><button type="button" className="secondary-button" disabled={busy} onClick={() => setDraft(null)}>Cancelar</button><button type="submit" className="primary-button" disabled={busy}>{busy ? "Salvando…" : "Salvar modelo"}</button></footer></form></section></div>}
  </main>;
}
