"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import Image from "next/image";
import { ApiRequestError } from "@/services/api/client";
import {
  connectWhatsappConnection,
  createWhatsappConnection,
  disconnectWhatsappConnection,
  getWhatsappConnectionQr,
  getWhatsappConnectionStatus,
  getWhatsappConnections,
  recoverWhatsappPairing,
  retryWhatsappStorage,
  updateWhatsappConnection,
  updateWhatsappConnectionActive,
} from "@/services/api/whatsapp-connections";
import type {
  WhatsappConnection,
  WhatsappConnectionQrResponse,
  WhatsappConnectionStatus,
} from "@/types/api";
import { useAuth } from "../auth/auth-provider";
import { Icon } from "../icons";

const STATUS_LABELS: Record<WhatsappConnectionStatus, string> = {
  disconnected: "Desconectado",
  connecting: "Conectando",
  qr_ready: "QR Code pronto",
  connected: "Conectado",
  reconnecting: "Reconectando",
  error: "Erro na conexão",
};

const STATUS_DESCRIPTIONS: Record<WhatsappConnectionStatus, string> = {
  disconnected: "A sessão está desconectada.",
  connecting: "A conexão está sendo iniciada.",
  qr_ready: "O QR Code está disponível para leitura.",
  connected: "A sessão está conectada ao WhatsApp.",
  reconnecting: "Tentando restabelecer a conexão.",
  error: "Não foi possível manter a conexão.",
};

const AUTH_MESSAGES: Record<string, string> = {
  logged_out: "O WhatsApp encerrou a autorização desta sessão. É necessária uma nova autorização.",
  credentials_rejected: "O WhatsApp rejeitou as credenciais de login. É necessária uma nova autorização.",
  pairing_incomplete: "O pareamento não foi concluído. Autorize um novo pareamento para obter outro QR Code.",
  storage_failure: "Falha ao salvar a autenticação. As credenciais foram preservadas; verifique o armazenamento antes de tentar novamente.",
  critical_failure: "A sessão foi interrompida por segurança. Verifique o diagnóstico antes de tentar novamente.",
  pairing_recovery_in_progress: "A preparação do novo pareamento foi interrompida. O estado anterior está preservado e precisa de revisão.",
  session_error: "A sessão exige revisão e uma nova autorização do WhatsApp.",
  reconnect_budget_exhausted: "O limite de reconexões foi atingido. Revise a sessão antes de autorizar um novo pareamento.",
};

interface QrState {
  qrCode: string;
  expiresAt: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Não foi possível concluir a solicitação.";
}

function getStatusClass(status: WhatsappConnectionStatus): string {
  if (status === "connected") return "whatsapp-status connected";
  if (status === "error") return "whatsapp-status error";
  if (status === "disconnected") return "whatsapp-status disconnected";
  return "whatsapp-status pending";
}

function hasPngDataUrl(qr: WhatsappConnectionQrResponse): boolean {
  return qr.qrCode.startsWith("data:image/png;base64,");
}

export function WhatsappConnectionsScreen({
  isVisible,
}: Readonly<{ isVisible: boolean }>) {
  const { user } = useAuth();
  const isAdmin = Boolean(user?.isAdmin);
  const [connections, setConnections] = useState<WhatsappConnection[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [toastMessage, setToastMessage] = useState("");
  const [busyIds, setBusyIds] = useState<Set<string>>(() => new Set());
  const [reloadKey, setReloadKey] = useState(0);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingConnection, setEditingConnection] =
    useState<WhatsappConnection | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [formError, setFormError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [qrConnectionId, setQrConnectionId] = useState<string | null>(null);
  const [qrState, setQrState] = useState<QrState | null>(null);
  const [qrExpired, setQrExpired] = useState(false);
  const [qrStatus, setQrStatus] =
    useState<WhatsappConnectionStatus>("connecting");
  const [qrError, setQrError] = useState("");
  const [isQrLoading, setIsQrLoading] = useState(true);
  const qrStateRef = useRef<QrState | null>(null);
  const actionInFlightRef = useRef(new Set<string>());
  const formInFlightRef = useRef(false);

  function beginAction(id: string): boolean {
    if (actionInFlightRef.current.has(id)) return false;
    actionInFlightRef.current.add(id);
    setBusyIds(new Set(actionInFlightRef.current));
    return true;
  }

  function endAction(id: string) {
    actionInFlightRef.current.delete(id);
    setBusyIds(new Set(actionInFlightRef.current));
  }

  const refreshList = useCallback(() => {
    setReloadKey((current) => current + 1);
  }, []);

  useEffect(() => {
    if (!toastMessage) return;
    const timer = window.setTimeout(() => setToastMessage(""), 3200);
    return () => window.clearTimeout(timer);
  }, [toastMessage]);

  useEffect(() => {
    if (!isVisible) return;

    let stopped = false;
    let inFlight = false;
    const controller = new AbortController();

    async function loadConnections(showLoading: boolean) {
      if (inFlight || stopped) return;
      inFlight = true;
      if (showLoading) setIsLoading(true);
      try {
        const result = await getWhatsappConnections(controller.signal);
        if (stopped) return;
        setConnections(result);
        setLoadError("");
      } catch (error) {
        if (!stopped && !controller.signal.aborted) {
          setLoadError(errorMessage(error));
        }
      } finally {
        inFlight = false;
        if (!stopped && showLoading) setIsLoading(false);
      }
    }

    void loadConnections(true);
    const interval = window.setInterval(() => {
      void loadConnections(false);
    }, 8000);

    return () => {
      stopped = true;
      controller.abort();
      window.clearInterval(interval);
    };
  }, [isVisible, reloadKey]);

  useEffect(() => {
    qrStateRef.current = qrState;
  }, [qrState]);

  useEffect(() => {
    if (!qrConnectionId || !isAdmin) return;
    const connectionId = qrConnectionId;

    let stopped = false;
    let timer: number | undefined;
    let inFlight = false;

    async function pollConnection() {
      if (stopped || inFlight) return;
      inFlight = true;
      setIsQrLoading(true);
      try {
        const status = await getWhatsappConnectionStatus(connectionId);
        if (stopped) return;
        setQrStatus(status.status);
        setQrError(status.authenticationIssue ? AUTH_MESSAGES[status.authenticationIssue] ?? "A sessão exige revisão administrativa." : "");
        setConnections((current) =>
          current.map((connection) =>
            connection.id.toLowerCase() === connectionId.toLowerCase()
              ? { ...connection, ...status }
              : connection,
          ),
        );

        if (status.status === "connected") {
          setQrState(null);
          setQrConnectionId(null);
          setQrError("");
          setToastMessage("Conexão WhatsApp realizada com sucesso.");
          refreshList();
          return;
        }

        if (status.status !== "qr_ready") {
          setQrState(null);
        }

        const existingQr = status.status === "qr_ready" ? qrStateRef.current : null;
        const isExistingQrExpired =
          existingQr !== null &&
          Date.parse(existingQr.expiresAt) <= Date.now();
        if (isExistingQrExpired) setQrExpired(true);
        const shouldRequestQr =
          status.status === "qr_ready" ||
          status.status === "connecting" ||
          status.status === "reconnecting";
        const qrIsMissingOrExpiring =
          status.status === "qr_ready" || !existingQr || Date.parse(existingQr.expiresAt) <= Date.now() + 3000;

        if (shouldRequestQr && qrIsMissingOrExpiring && !status.authenticationIssue) {
          try {
            const qr = await getWhatsappConnectionQr(connectionId);
            if (stopped) return;
            if (!qr.qrCode) {
              // QR generation and the 515 handoff legitimately return null.
              setQrState(null);
              setQrError("");
            } else if (!hasPngDataUrl(qr)) {
              setQrError("A API retornou um QR Code em formato inválido.");
              setQrState(null);
            } else if (Date.parse(qr.expiresAt) > Date.now()) {
              setQrState(qr);
              setQrExpired(false);
              setQrError("");
            } else {
              setQrState(null);
            }
          } catch (error) {
            if (stopped) return;
            if (
              !(error instanceof ApiRequestError && error.status === 404)
            ) {
              setQrError(errorMessage(error));
            }
            if (
              qrStateRef.current &&
              Date.parse(qrStateRef.current.expiresAt) <= Date.now()
            ) {
              setQrState(null);
              setQrExpired(true);
            }
          }
        }
      } catch (error) {
        if (!stopped) setQrError(errorMessage(error));
      } finally {
        inFlight = false;
        if (!stopped) {
          setIsQrLoading(false);
          timer = window.setTimeout(() => void pollConnection(), 2500);
        }
      }
    }

    void pollConnection();
    return () => {
      stopped = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [isAdmin, qrConnectionId, refreshList]);

  function openCreateForm() {
    setEditingConnection(null);
    setNameDraft("");
    setFormError("");
    setIsFormOpen(true);
  }

  function openEditForm(connection: WhatsappConnection) {
    setEditingConnection(connection);
    setNameDraft(connection.name);
    setFormError("");
    setIsFormOpen(true);
  }

  async function saveConnection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (formInFlightRef.current) return;
    formInFlightRef.current = true;
    setFormError("");
    setIsSaving(true);
    try {
      if (editingConnection) {
        await updateWhatsappConnection(editingConnection.id, {
          name: nameDraft.trim(),
        });
        setToastMessage("Conexão atualizada com sucesso.");
      } else {
        await createWhatsappConnection({
          name: nameDraft.trim(),
          isActive: true,
        });
        setToastMessage("Conexão cadastrada com sucesso.");
      }
      setIsFormOpen(false);
      refreshList();
    } catch (error) {
      setFormError(errorMessage(error));
    } finally {
      formInFlightRef.current = false;
      setIsSaving(false);
    }
  }

  async function toggleActive(connection: WhatsappConnection) {
    if (connection.isActive && !window.confirm(`Inativar "${connection.name}" e desconectar a sessão? As credenciais serão preservadas.`)) return;
    if (!beginAction(connection.id)) return;
    setActionError("");
    try {
      const nextActive = !connection.isActive;
      await updateWhatsappConnectionActive(connection.id, nextActive);
      setToastMessage(
        nextActive
          ? "Conexão ativada com sucesso."
          : "Conexão inativada com sucesso.",
      );
      refreshList();
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      endAction(connection.id);
    }
  }

  function clearQrModal() {
    setQrConnectionId(null);
    setQrState(null);
    setQrExpired(false);
    setQrError("");
  }

  async function startConnection(connection: WhatsappConnection) {
    if (!beginAction(connection.id)) return;
    setActionError("");
    try {
      const result = await connectWhatsappConnection(connection.id);
      setQrStatus(result.status);
      setQrState(null);
      setQrExpired(false);
      setQrError("");
      setQrConnectionId(connection.id);
      setIsQrLoading(true);
      refreshList();
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      endAction(connection.id);
    }
  }

  function showQr(connection: WhatsappConnection) {
    setQrStatus(connection.status);
    setQrState(null);
    setQrExpired(false);
    setQrError("");
    setIsQrLoading(true);
    setQrConnectionId(connection.id);
  }

  async function disconnect(connection: WhatsappConnection) {
    if (!window.confirm(`Desconectar "${connection.name}"? As credenciais serão preservadas.`)) return;
    if (!beginAction(connection.id)) return;
    setActionError("");
    try {
      await disconnectWhatsappConnection(connection.id);
      if (qrConnectionId === connection.id) clearQrModal();
      setToastMessage("Conexão interrompida. As credenciais foram preservadas.");
      refreshList();
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      endAction(connection.id);
    }
  }

  async function recoverPairing(connection: WhatsappConnection) {
    if (actionInFlightRef.current.has(connection.id)) return;
    const confirmed = window.confirm(
      `Autorizar novo pareamento de "${connection.name}"? O estado atual será preservado em cópia recuperável e uma nova autenticação será preparada somente para esta conexão. Será necessário escanear um novo QR Code. Contatos e mensagens serão preservados.`,
    );
    if (!confirmed) return;

    if (!beginAction(connection.id)) return;
    setActionError("");
    try {
      await recoverWhatsappPairing(connection.id);
      if (qrConnectionId === connection.id) clearQrModal();
      setToastMessage(
        "Estado anterior preservado. Clique em Conectar para escanear um novo QR Code.",
      );
      refreshList();
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      endAction(connection.id);
    }
  }

  async function retryStorage(connection: WhatsappConnection) {
    if (!beginAction(connection.id)) return;
    setActionError("");
    try {
      await retryWhatsappStorage(connection.id);
      setToastMessage("Retomada solicitada com as credenciais existentes.");
      refreshList();
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      endAction(connection.id);
    }
  }

  async function retryConnection() {
    if (!qrConnectionId) return;
    const connection = connections.find(
      (candidate) => candidate.id === qrConnectionId,
    );
    if (!connection) return;
    await startConnection(connection);
  }

  const qrConnection = connections.find(
    (connection) => connection.id === qrConnectionId,
  );
  const qrCanBeShown =
    qrState !== null &&
    !qrExpired &&
    qrStatus !== "disconnected" &&
    qrStatus !== "reconnecting" &&
    qrStatus !== "error";

  return (
    <>
      <main className="main-content whatsapp-content">
        <div className="page-heading">
          <div>
            <p className="eyebrow">Integrações</p>
            <h1>Conexões WhatsApp</h1>
            <p className="page-subtitle">
              Gerencie os aparelhos conectados à operação.
            </p>
          </div>
          <button
            className="primary-button"
            onClick={openCreateForm}
            type="button"
          >
            <Icon name="plus" size={16} />
            Nova conexão
          </button>
        </div>

        {loadError && (
          <div className="inline-error" role="alert">
            Não foi possível carregar as conexões. {loadError}
            <button
              className="secondary-button whatsapp-retry"
              onClick={refreshList}
              type="button"
            >
              Tentar novamente
            </button>
          </div>
        )}
        {actionError && (
          <div className="inline-error" role="alert">
            {actionError}
          </div>
        )}

        <div className="results-summary">
          <span>
            {isLoading
              ? "Carregando conexões..."
              : `${connections.length} ${connections.length === 1 ? "conexão cadastrada" : "conexões cadastradas"}`}
          </span>
          <button
            aria-label="Atualizar lista de conexões"
            className="icon-button"
            disabled={isLoading}
            onClick={refreshList}
            title="Atualizar"
            type="button"
          >
            <Icon name="refresh" size={15} />
          </button>
        </div>

        {isLoading ? (
          <div className="table-panel loading-state" role="status">
            Carregando conexões da API...
          </div>
        ) : !loadError ? (
          <div className="table-panel whatsapp-table-panel">
            <div className="contact-table-scroll">
              <table className="settings-table whatsapp-table">
                <thead>
                  <tr>
                    <th>Nome interno</th>
                    <th>Número identificado</th>
                    <th>Conexão</th>
                    <th>Situação</th>
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {connections.map((connection) => (
                    <tr key={connection.id}>
                      <td>
                        <span className="settings-name">{connection.name}</span>
                      </td>
                      <td>{connection.phoneNumber || "—"}</td>
                      <td>
                        <span
                          className={getStatusClass(connection.status)}
                          title={STATUS_DESCRIPTIONS[connection.status]}
                        >
                          {STATUS_LABELS[connection.status]}
                        </span>
                        <span className="whatsapp-status-description">
                          {connection.authenticationIssue ? AUTH_MESSAGES[connection.authenticationIssue] ?? "A sessão exige revisão administrativa." : STATUS_DESCRIPTIONS[connection.status]}
                        </span>
                      </td>
                      <td>
                        <span
                          className={`status-pill ${connection.isActive ? "active" : "inactive"}`}
                        >
                          {connection.isActive ? "Ativa" : "Inativa"}
                        </span>
                      </td>
                      <td>
                        <div className="whatsapp-row-actions">
                          <button
                            aria-label={`Editar ${connection.name}`}
                            className="icon-button"
                            disabled={busyIds.has(connection.id)}
                            onClick={() => openEditForm(connection)}
                            title="Editar nome"
                            type="button"
                          >
                            <Icon name="edit" size={15} />
                          </button>
                          <button
                            aria-label={`${connection.isActive ? "Inativar" : "Ativar"} ${connection.name}`}
                            className="icon-button"
                            disabled={busyIds.has(connection.id)}
                            onClick={() => void toggleActive(connection)}
                            title={connection.isActive ? "Inativar" : "Ativar"}
                            type="button"
                          >
                            <Icon
                              name={connection.isActive ? "deactivate" : "activate"}
                              size={15}
                            />
                          </button>
                          {isAdmin && (
                            <>
                              {connection.isActive &&
                                (connection.status === "disconnected" ||
                                  connection.status === "error") && (
                                  <button
                                    className="secondary-button whatsapp-action-button"
                                    disabled={busyIds.has(connection.id) || !!connection.authenticationIssue}
                                    onClick={() =>
                                      void startConnection(connection)
                                    }
                                    type="button"
                                  >
                                    Conectar
                                  </button>
                                )}
                              {connection.isActive &&
                                (connection.status === "connecting" ||
                                  connection.status === "qr_ready") && (
                                  <button
                                    className="secondary-button whatsapp-action-button"
                                    disabled={busyIds.has(connection.id)}
                                    onClick={() => showQr(connection)}
                                    type="button"
                                  >
                                    QR Code
                                  </button>
                                )}
                              {connection.status !== "disconnected" && (
                                <button
                                  className="secondary-button whatsapp-action-button"
                                  disabled={busyIds.has(connection.id)}
                                  onClick={() => void disconnect(connection)}
                                  type="button"
                                >
                                  Desconectar
                                </button>
                              )}
                              {connection.isActive && connection.authenticationIssue === "storage_failure" && (connection.status === "disconnected" || connection.status === "error") && <button
                                className="secondary-button whatsapp-action-button"
                                disabled={busyIds.has(connection.id)}
                                onClick={() => void retryStorage(connection)}
                                title="Tentar retomar com as credenciais existentes após verificar o armazenamento"
                                type="button"
                              >
                                Retomar sessão
                              </button>}
                              {connection.requiresPairingRecovery && (connection.status === "disconnected" || connection.status === "error") && <button
                                className="icon-button whatsapp-logout-button"
                                disabled={busyIds.has(connection.id)}
                                onClick={() =>
                                  void recoverPairing(connection)
                                }
                                title="Preservar o estado anterior e autorizar novo pareamento"
                                type="button"
                              >
                                Autorizar novo pareamento
                              </button>}
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {connections.length === 0 && (
                    <tr>
                      <td className="empty-state" colSpan={5}>
                        <strong>Nenhuma conexão cadastrada</strong>
                        <p>Cadastre uma conexão para começar.</p>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </main>

      {isFormOpen && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !isSaving) {
              setIsFormOpen(false);
            }
          }}
        >
          <section
            aria-labelledby="whatsapp-form-title"
            aria-modal="true"
            className="modal"
            role="dialog"
          >
            <form onSubmit={(event) => void saveConnection(event)}>
              <div className="modal-header">
                <div>
                  <h2 id="whatsapp-form-title">
                    {editingConnection ? "Editar conexão" : "Nova conexão"}
                  </h2>
                  <p>Defina o nome interno para identificar este aparelho.</p>
                </div>
                <button
                  aria-label="Fechar"
                  className="icon-button"
                  disabled={isSaving}
                  onClick={() => setIsFormOpen(false)}
                  type="button"
                >
                  <Icon name="close" size={17} />
                </button>
              </div>
              <div className="modal-body">
                {formError && (
                  <div className="form-error" role="alert">
                    {formError}
                  </div>
                )}
                <div className="form-field">
                  <label htmlFor="whatsapp-connection-name">
                    Nome interno
                  </label>
                  <input
                    autoFocus
                    id="whatsapp-connection-name"
                    maxLength={150}
                    onChange={(event) => setNameDraft(event.target.value)}
                    placeholder="Ex.: Atendimento da unidade"
                    required
                    value={nameDraft}
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button
                  className="secondary-button"
                  disabled={isSaving}
                  onClick={() => setIsFormOpen(false)}
                  type="button"
                >
                  Cancelar
                </button>
                <button
                  className="primary-button"
                  disabled={isSaving || !nameDraft.trim()}
                  type="submit"
                >
                  {isSaving ? "Salvando..." : "Salvar"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {qrConnectionId && qrConnection && isAdmin && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) clearQrModal();
          }}
        >
          <section
            aria-labelledby="whatsapp-qr-title"
            aria-modal="true"
            className="modal whatsapp-qr-modal"
            role="dialog"
          >
            <div className="modal-header">
              <div>
                <h2 id="whatsapp-qr-title">
                  Conectar {qrConnection.name}
                </h2>
                <p>Escaneie o QR Code pelo aplicativo WhatsApp.</p>
              </div>
              <button
                aria-label="Fechar QR Code"
                className="icon-button"
                onClick={clearQrModal}
                type="button"
              >
                <Icon name="close" size={17} />
              </button>
            </div>
            <div className="modal-body whatsapp-qr-body">
              <p className="whatsapp-qr-instructions">
                No celular, abra <strong>WhatsApp</strong> &gt;{" "}
                <strong>Aparelhos conectados</strong> &gt;{" "}
                <strong>Conectar um aparelho</strong> e escaneie este QR Code.
              </p>

              {qrCanBeShown ? (
                <div className="whatsapp-qr-image-wrap">
                  {/* The API returns a temporary PNG data URL for the current QR. */}
                  <Image
                    alt="QR Code temporário para conectar o WhatsApp"
                    className="whatsapp-qr-image"
                    height={280}
                    src={qrState.qrCode}
                    unoptimized
                    width={280}
                  />
                  <span>
                    Válido até{" "}
                    {new Date(qrState.expiresAt).toLocaleTimeString("pt-BR", {
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    })}
                  </span>
                </div>
              ) : (
                <div className="whatsapp-qr-pending" role="status">
                  {qrStatus === "connected" ? (
                    <strong>Conexão estabelecida.</strong>
                  ) : qrStatus === "disconnected" || qrStatus === "error" ? (
                    <>
                      <strong>
                        {qrStatus === "error"
                          ? "A sessão apresentou um erro."
                          : "A sessão está desconectada."}
                      </strong>
                      <span>
                        {qrConnection.authenticationIssue
                          ? AUTH_MESSAGES[qrConnection.authenticationIssue] ?? "A sessão exige revisão administrativa."
                          : "Inicie a conexão novamente para solicitar um novo QR Code."}
                      </span>
                      <button
                        className="primary-button"
                        disabled={busyIds.has(qrConnection.id) || !!qrConnection.authenticationIssue}
                        onClick={() => void retryConnection()}
                        type="button"
                      >
                        {busyIds.has(qrConnection.id)
                          ? "Iniciando..."
                          : "Tentar conectar novamente"}
                      </button>
                    </>
                  ) : qrExpired ? (
                    <>
                      <strong>Este QR Code expirou.</strong>
                      <span>Aguardando um novo QR Code da conexão...</span>
                    </>
                  ) : (
                    <>
                      <span className="whatsapp-qr-spinner" aria-hidden="true" />
                      <strong>
                        {qrStatus === "reconnecting"
                          ? "Restabelecendo conexão..."
                          : "Aguardando QR Code..."}
                      </strong>
                      <span>
                        O QR Code será exibido assim que estiver disponível.
                      </span>
                    </>
                  )}
                </div>
              )}

              {qrError && (
                <div className="form-error" role="alert">
                  {qrError}
                </div>
              )}
              {isQrLoading && (
                <span className="sr-only" role="status">
                  Atualizando estado da conexão.
                </span>
              )}
              <p className="whatsapp-qr-security">
                O QR Code é temporário e não é armazenado neste navegador.
              </p>
            </div>
            <div className="modal-footer">
              <button
                className="secondary-button"
                onClick={clearQrModal}
                type="button"
              >
                Fechar
              </button>
            </div>
          </section>
        </div>
      )}

      {toastMessage && (
        <div className="toast" role="status">
          <Icon name="check" size={16} />
          {toastMessage}
        </div>
      )}
    </>
  );
}
