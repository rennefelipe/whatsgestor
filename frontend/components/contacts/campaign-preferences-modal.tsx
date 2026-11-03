"use client";

import { FullTextSelect } from "../full-text-select";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useAuth } from "../auth/auth-provider";
import { Icon } from "../icons";
import type { Contact, ContactOptions } from "@/types/api";
import {
  createCampaignPreference,
  getAllCampaignPreferences,
  getCampaignPreferenceEvents,
  getCampaignPreferences,
  revokeCampaignPreference,
  type CampaignPreference,
  type PreferenceEvent,
  type PreferencePage,
} from "@/services/api/campaign-preferences";

const message = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "Não foi possível consultar as restrições de envio.";
const date = (value: string) => new Date(value).toLocaleString("pt-BR");

export function CampaignPreferencesModal({
  contact,
  options,
  onClose,
}: {
  contact: Contact | null;
  options: ContactOptions;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const dialog = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<PreferencePage | null>(null);
  const [page, setPage] = useState(1);
  const [reload, setReload] = useState(0);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [target, setTarget] = useState("phone");
  const [shoppingId, setShoppingId] = useState("");
  const [reason, setReason] = useState("");
  const [revoking, setRevoking] = useState<CampaignPreference | null>(null);
  const [justification, setJustification] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [history, setHistory] = useState<{
    id: string;
    page: number;
    total: number;
    items: PreferenceEvent[];
  } | null>(null);
  const admin = !!user?.isAdmin;
  const shoppings = [
    ...new Map(
      options.organizationContexts.flatMap((context) =>
        context.shopping && !context.hierarchyIssue
          ? [[context.shopping.id, context.shopping] as const]
          : [],
      ),
    ).values(),
  ];

  useEffect(() => {
    const controller = new AbortController();
    (contact
      ? getCampaignPreferences(contact.id, page, controller.signal)
      : getAllCampaignPreferences(page, controller.signal)
    )
      .then((result) => {
        if (!controller.signal.aborted) {
          setData(result);
          setLoading(false);
        }
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) {
          setData(null);
          setError(message(failure));
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [contact, page, reload, user?.id]);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    return () => previous?.focus();
  }, []);
  function keydown(event: React.KeyboardEvent) {
    if (event.key === "Escape" && !busy) onClose();
    if (event.key === "Tab") {
      const elements = dialog.current?.querySelectorAll<HTMLElement>(
        "button:not(:disabled), input:not(:disabled), select:not(:disabled)",
      );
      if (!elements?.length) return;
      const first = elements[0],
        last = elements[elements.length - 1];
      if (
        event.shiftKey &&
        (document.activeElement === first ||
          document.activeElement === dialog.current)
      ) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!contact) return;
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      await createCampaignPreference(contact.id, {
        target: target === "phone" ? "phone" : "identity",
        ...(target !== "phone" ? { evidenceConversationId: target } : {}),
        shoppingId: shoppingId || null,
        reason,
      });
      setReason("");
      setPage(1);
      setReload((value) => value + 1);
      setSuccess("Bloqueio registrado e auditado.");
    } catch (failure) {
      setError(message(failure));
    } finally {
      setBusy(false);
    }
  }
  async function revoke(event: FormEvent) {
    event.preventDefault();
    if (!revoking) return;
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      await revokeCampaignPreference(revoking.id, {
        version: revoking.version,
        reason: justification,
        confirmed,
      });
      setRevoking(null);
      setHistory(null);
      setReload((value) => value + 1);
      setSuccess("Bloqueio revogado. O histórico foi preservado.");
    } catch (failure) {
      setError(message(failure));
      setRevoking(null);
      setReload((value) => value + 1);
    } finally {
      setBusy(false);
    }
  }
  async function showHistory(id: string, historyPage = 1) {
    setBusy(true);
    setError("");
    try {
      const result = await getCampaignPreferenceEvents(id, historyPage);
      setHistory({
        id,
        page: result.page,
        total: result.total,
        items: result.items,
      });
    } catch (failure) {
      setError(message(failure));
      setHistory(null);
    } finally {
      setBusy(false);
    }
  }
  const scope = (id: string | null) =>
    id
      ? (shoppings.find((shopping) => shopping.id === id)?.name ??
        `Shopping ${id}`)
      : "Global — todos os shoppings";
  return (
    <div className="modal-backdrop">
      <div
        className="modal campaign-preferences-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="campaign-preferences-title"
        tabIndex={-1}
        ref={dialog}
        onKeyDown={keydown}
      >
        <header className="modal-header">
          <div>
            <h2 id="campaign-preferences-title">Restrições de envio</h2>
            <p>
              {contact
                ? `${contact.contactName} · ${contact.phone}`
                : "Registro permanente · todas as restrições"}
            </p>
          </div>
          <button
            className="icon-button"
            aria-label="Fechar restrições"
            disabled={busy}
            onClick={onClose}
          >
            <Icon name="close" />
          </button>
        </header>
        <div className="modal-body">
          <p className="page-subtitle">
            Restrições apenas para campanhas. O atendimento individual em
            Conversas permanece disponível.
          </p>
          {error && (
            <div className="form-error" role="alert">
              {error}{" "}
              <button
                type="button"
                className="secondary-button"
                disabled={busy}
                onClick={() => {
                  setError("");
                  setLoading(true);
                  setReload((value) => value + 1);
                }}
              >
                Atualizar consulta
              </button>
            </div>
          )}
          {success && (
            <div role="status" className="campaign-notice">
              {success}
            </div>
          )}
          {loading && <p role="status">Consultando restrições…</p>}
          {data && (
            <>
              <div className="campaign-notice">
                {!contact ? (
                  "Restrições e histórico permanecem disponíveis mesmo quando o cadastro de origem é excluído."
                ) : data.normalizedPhone ? (
                  <>
                    <strong>{data.normalizedPhone}</strong> está presente em{" "}
                    <strong>{data.affectedContacts} cadastros</strong>. Um
                    bloqueio por número atinge os cadastros equivalentes
                    conforme a abrangência escolhida.
                  </>
                ) : (
                  "Telefone sem normalização válida. Somente identidades comprovadas podem ser utilizadas."
                )}
                <p>
                  O bloqueio global prevalece. Revogar um bloqueio não revoga
                  outros bloqueios ativos.
                </p>
              </div>
              {admin && contact ? (
                <form onSubmit={save} className="campaign-preference-form">
                  <h3>Registrar bloqueio</h3>
                  <div className="form-grid">
                    <div className="form-field">
                      <label htmlFor="campaign-target">Identificação</label>
                      <FullTextSelect
                        id="campaign-target"
                        value={target}
                        disabled={busy}
                        onChange={(event) => setTarget(event.target.value)}
                      >
                        <option value="phone" disabled={!data.normalizedPhone}>
                          Telefone normalizado
                        </option>
                        {data.identities.map((identity) => (
                          <option
                            key={identity.conversationId}
                            value={identity.conversationId}
                          >
                            LID {identity.whatsappIdentity} · conexão{" "}
                            {identity.connectionId.slice(0, 8)}
                          </option>
                        ))}
                      </FullTextSelect>
                    </div>
                    <div className="form-field">
                      <label htmlFor="campaign-scope">Abrangência</label>
                      <FullTextSelect
                        id="campaign-scope"
                        value={shoppingId}
                        disabled={busy}
                        onChange={(event) => setShoppingId(event.target.value)}
                      >
                        <option value="">Global — todos os shoppings</option>
                        {shoppings.map((shopping) => (
                          <option key={shopping.id} value={shopping.id}>
                            {shopping.name}
                          </option>
                        ))}
                      </FullTextSelect>
                    </div>
                  </div>
                  {target !== "phone" && (
                    <p className="page-subtitle">
                      O bloqueio usa somente o LID e a conexão comprovados. Não
                      cria equivalência com o telefone.
                    </p>
                  )}
                  <div className="form-field">
                    <label htmlFor="campaign-reason">Motivo do bloqueio</label>
                    <input
                      id="campaign-reason"
                      minLength={3}
                      maxLength={500}
                      required
                      value={reason}
                      disabled={busy}
                      onChange={(event) => setReason(event.target.value)}
                      placeholder="Ex.: solicitação do responsável"
                    />
                  </div>
                  <button
                    className="primary-button"
                    disabled={
                      busy ||
                      loading ||
                      (target === "phone" && !data.normalizedPhone) ||
                      reason.trim().length < 3
                    }
                  >
                    Registrar bloqueio
                  </button>
                </form>
              ) : (
                <p className="campaign-notice">
                  {admin
                    ? "Para registrar um novo bloqueio, abra as restrições de envio de um contato na listagem."
                    : "Consulta disponível. Somente administradores podem registrar ou revogar bloqueios."}
                </p>
              )}
              <section aria-label="Restrições cadastradas">
                <h3>Restrições cadastradas</h3>
                {!data.items.length && (
                  <p className="page-subtitle">
                    Nenhuma restrição cadastrada para esta identificação. Isso
                    não representa autorização de envio.
                  </p>
                )}
                {data.items.map((preference) => (
                  <article
                    className="campaign-preference-card"
                    key={preference.id}
                  >
                    <div className="campaign-preference-heading">
                      <strong>{scope(preference.shoppingId)}</strong>
                      <span
                        className={`status-pill ${preference.isActive ? "inactive" : "active"}`}
                      >
                        {preference.isActive ? "Bloqueado" : "Revogado"}
                      </span>
                    </div>
                    <p>
                      {preference.normalizedPhone ||
                        `${preference.whatsappIdentity} · conexão ${preference.connectionId?.slice(0, 8)}`}
                    </p>
                    <p>{preference.reason}</p>
                    <small>
                      Registrado em {date(preference.createdAt)}
                      {preference.revokedAt &&
                        ` · Revogado em ${date(preference.revokedAt)}`}
                    </small>
                    <div className="campaign-preference-actions">
                      <button
                        className="secondary-button"
                        disabled={busy}
                        onClick={() => void showHistory(preference.id)}
                      >
                        Histórico
                      </button>
                      {admin && preference.isActive && (
                        <button
                          className="secondary-button"
                          disabled={busy}
                          onClick={() => {
                            setRevoking(preference);
                            setJustification("");
                            setConfirmed(false);
                          }}
                        >
                          Revogar bloqueio
                        </button>
                      )}
                    </div>
                  </article>
                ))}
                {data.total > 10 && (
                  <nav
                    className="campaign-preference-actions"
                    aria-label="Paginação das restrições"
                  >
                    <button
                      className="secondary-button"
                      disabled={page === 1 || busy}
                      onClick={() => {
                        setLoading(true);
                        setPage((value) => value - 1);
                      }}
                    >
                      Anterior
                    </button>
                    <span>
                      Página {page} · {data.total} restrições
                    </span>
                    <button
                      className="secondary-button"
                      disabled={page * 10 >= data.total || busy}
                      onClick={() => {
                        setLoading(true);
                        setPage((value) => value + 1);
                      }}
                    >
                      Próxima
                    </button>
                  </nav>
                )}
              </section>
              {revoking && (
                <form onSubmit={revoke} className="campaign-preference-form">
                  <h3>Confirmar revogação</h3>
                  <p>
                    {scope(revoking.shoppingId)} ·{" "}
                    {revoking.normalizedPhone || revoking.whatsappIdentity}
                  </p>
                  <div className="form-field">
                    <label htmlFor="campaign-justification">
                      Justificativa da revogação
                    </label>
                    <input
                      id="campaign-justification"
                      required
                      minLength={3}
                      maxLength={500}
                      value={justification}
                      disabled={busy}
                      onChange={(event) => setJustification(event.target.value)}
                    />
                  </div>
                  <label className="campaign-confirm">
                    <input
                      type="checkbox"
                      required
                      checked={confirmed}
                      disabled={busy}
                      onChange={(event) => setConfirmed(event.target.checked)}
                    />
                    Confirmo a revogação deste bloqueio. Outros bloqueios ativos
                    continuam válidos.
                  </label>
                  <div className="campaign-preference-actions">
                    <button
                      className="primary-button"
                      disabled={
                        busy || !confirmed || justification.trim().length < 3
                      }
                    >
                      Confirmar revogação
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={busy}
                      onClick={() => setRevoking(null)}
                    >
                      Cancelar
                    </button>
                  </div>
                </form>
              )}
              {history && (
                <section
                  className="campaign-preference-form"
                  aria-label="Histórico de restrições"
                >
                  <h3>Histórico de alterações</h3>
                  {history.items.map((event) => (
                    <article
                      key={event.id}
                      className="campaign-preference-card"
                    >
                      <strong>
                        {event.action === "block"
                          ? "Bloqueio registrado"
                          : "Bloqueio revogado"}
                      </strong>
                      <p>{event.reason}</p>
                      <small>
                        {event.actorUsername} · {date(event.createdAt)}
                      </small>
                    </article>
                  ))}
                  <div className="campaign-preference-actions">
                    <button
                      className="secondary-button"
                      disabled={busy || history.page === 1}
                      onClick={() =>
                        void showHistory(history.id, history.page - 1)
                      }
                    >
                      Anterior
                    </button>
                    <span>
                      {history.total} eventos · página {history.page}
                    </span>
                    <button
                      className="secondary-button"
                      disabled={busy || history.page * 10 >= history.total}
                      onClick={() =>
                        void showHistory(history.id, history.page + 1)
                      }
                    >
                      Próxima
                    </button>
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
