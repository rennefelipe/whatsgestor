"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useAuth } from "../auth/auth-provider";
import { Icon } from "../icons";
import { ApiRequestError } from "@/services/api/client";
import { apiRequest } from "@/services/api/client";
import {
  claimWhatsappAttendance,
  finishWhatsappAttendance,
  reopenWhatsappAttendance,
  assignWhatsappAttendance,
  getWhatsappConversation,
} from "@/services/api/whatsapp-conversations";
import type { AuthenticatedUser, WhatsappConversation } from "@/types/api";
import {
  attendanceLabel,
  canManageAttendance,
} from "./conversation-attendance";

type Action = "claim" | "finish" | "reopen" | "assign";
type ConfirmAction = Action;
const titles: Record<Action, string> = {
  claim: "Iniciar atendimento",
  finish: "Finalizar atendimento",
  reopen: "Reabrir atendimento",
  assign: "Transferir atendimento",
};
const successes: Record<Action, string> = {
  claim: "Atendimento iniciado com sucesso.",
  finish: "Atendimento finalizado com sucesso.",
  reopen: "Atendimento reaberto com sucesso.",
  assign: "Atendimento transferido com sucesso.",
};

export function ConversationAttendanceControls({
  conversation,
  onUpdated,
}: {
  conversation: WhatsappConversation;
  onUpdated: (updated: WhatsappConversation) => void;
}) {
  const { user, refreshUser } = useAuth();
  const busyRef = useRef(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [modal, setModal] = useState<{
    action: ConfirmAction;
    conversation: WhatsappConversation;
  } | null>(null);
  const [users, setUsers] = useState<Pick<AuthenticatedUser, "id" | "username" | "isActive">[]>([]);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState("");
  const [retryUsers, setRetryUsers] = useState(0);
  const [notice, setNotice] = useState<{
    id: string;
    text: string;
    error: boolean;
  } | null>(null);
  const [needsRefreshId, setNeedsRefreshId] = useState<string | null>(null);
  const modalId = modal?.conversation.id;
  const modalAction = modal?.action;
  const target =
    modal?.conversation.id === conversation.id
      ? conversation
      : modal?.conversation;
  const permissions = canManageAttendance(user, conversation);
  const modalAllowed =
    target && modal ? canManageAttendance(user, target)[modal.action] : false;

  useEffect(() => {
    if (!modalId) return;
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, [modalId, modalAction]);

  useEffect(() => {
    if (modalAction !== "assign" || !user?.isActive || user.role === "tester") return;
    const controller = new AbortController();
    void apiRequest<Pick<AuthenticatedUser, "id" | "username" | "isActive">[]>("/whatsapp-conversations/attendance/assignees", { signal: controller.signal })
      .then((items) => {
        if (!controller.signal.aborted)
          setUsers(items.filter((item) => item.isActive));
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setUsersError(
            error instanceof Error
              ? error.message
              : "Não foi possível carregar os usuários.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setUsersLoading(false);
      });
    return () => controller.abort();
  }, [modalId, modalAction, user?.isActive, user?.isAdmin, user?.role, retryUsers]);

  function openModal(action: ConfirmAction) {
    if (
      busyRef.current ||
      !permissions[action] ||
      needsRefreshId === conversation.id
    )
      return;
    setNotice(null);
    setUsers([]);
    setSelectedUserId("");
    setUsersError("");
    setUsersLoading(action === "assign");
    setModal({ action, conversation });
  }

  async function reloadAttendance(id: string) {
    if (busyRef.current) return;
    busyRef.current = true;
    setIsBusy(true);
    try {
      onUpdated(await getWhatsappConversation(id));
      setNeedsRefreshId(null);
      setNotice({
        id,
        text: "Situação do atendimento atualizada.",
        error: false,
      });
    } catch (error) {
      setNotice({
        id,
        text:
          error instanceof Error
            ? error.message
            : "Não foi possível atualizar o atendimento.",
        error: true,
      });
    } finally {
      busyRef.current = false;
      setIsBusy(false);
    }
  }

  async function perform(
    action: Action,
    item: WhatsappConversation,
    assignedUserId?: string,
  ) {
    if (
      busyRef.current ||
      !canManageAttendance(user, item)[action] ||
      needsRefreshId === item.id
    )
      return;
    if (
      action === "assign" &&
      !users.some(
        (candidate) =>
          candidate.id === assignedUserId &&
          candidate.isActive &&
          candidate.id !== item.assignedUserId,
      )
    )
      return;
    busyRef.current = true;
    setIsBusy(true);
    setNotice(null);
    try {
      const updated =
        action === "claim"
          ? await claimWhatsappAttendance(item.id)
          : action === "finish"
            ? await finishWhatsappAttendance(item.id)
            : action === "reopen"
              ? await reopenWhatsappAttendance(item.id)
              : await assignWhatsappAttendance(item.id, assignedUserId!);
      onUpdated(updated);
      setNeedsRefreshId(null);
      setModal(null);
      setNotice({ id: item.id, text: successes[action], error: false });
    } catch (error) {
      const conflict = error instanceof ApiRequestError && error.status === 409;
      const forbidden =
        error instanceof ApiRequestError && error.status === 403;
      let text = conflict
        ? "O atendimento foi alterado por outro usuário."
        : error instanceof Error
          ? error.message
          : "Não foi possível atualizar o atendimento.";
      if (conflict || forbidden) {
        setModal(null);
        // Keep actions blocked until the authoritative detail request completes.
        setNeedsRefreshId(item.id);
        if (forbidden) await refreshUser().catch(() => undefined);
        try {
          onUpdated(await getWhatsappConversation(item.id));
          setNeedsRefreshId(null);
          text += " Os dados da conversa foram atualizados.";
        } catch {
          text +=
            " Não foi possível atualizar a conversa. Tente atualizar o atendimento.";
        }
      }
      setNotice({ id: item.id, text, error: true });
    } finally {
      busyRef.current = false;
      setIsBusy(false);
    }
  }

  const availableUsers = users.filter(
    (item) => item.isActive && item.id !== target?.assignedUserId,
  );
  const selectedUser = availableUsers.find(
    (item) => item.id === selectedUserId,
  );
  const disabled = isBusy || needsRefreshId === conversation.id;
  const visibleNotice = notice?.id === conversation.id ? notice : null;

  return (
    <>
      <div
        className="conversation-attendance-toolbar"
        aria-label="Controle de atendimento"
      >
        <span
          className={`conversation-attendance-status ${conversation.attendanceStatus}`}
          title={attendanceLabel(conversation.attendanceStatus)}
          aria-label={attendanceLabel(conversation.attendanceStatus)}
          role="status"
        >
          <span className="attendance-status-full">
            {attendanceLabel(conversation.attendanceStatus)}
          </span>
          <span className="attendance-status-compact" aria-hidden="true">
            {conversation.attendanceStatus === "waiting"
              ? "Aguardando"
              : attendanceLabel(conversation.attendanceStatus)}
          </span>
        </span>
        {conversation.assignedUser?.username && (
          <span
            className="conversation-attendance-owner"
            title={conversation.assignedUser.username}
          >
            Responsável: {conversation.assignedUser.username}
          </span>
        )}
        <div className="conversation-attendance-actions">
          {permissions.claim && (
            <button
              className="conversation-contact-action conversation-start-action"
              type="button"
              disabled={disabled}
              onClick={() => openModal("claim")}
            >
              Iniciar atendimento
            </button>
          )}
          {permissions.finish && (
            <button
              className="conversation-contact-action conversation-finish-action"
              type="button"
              disabled={disabled}
              onClick={() => openModal("finish")}
            >
              Finalizar atendimento
            </button>
          )}
          {permissions.assign && (
            <button
              className="conversation-contact-action"
              type="button"
              disabled={disabled}
              onClick={() => openModal("assign")}
            >
              Transferir atendimento
            </button>
          )}
          {permissions.reopen && (
            <button
              className="conversation-contact-action"
              type="button"
              disabled={disabled}
              onClick={() => openModal("reopen")}
            >
              Reabrir atendimento
            </button>
          )}
          {needsRefreshId === conversation.id && (
            <button
              className="conversation-contact-action"
              type="button"
              disabled={isBusy}
              onClick={() => void reloadAttendance(conversation.id)}
            >
              Atualizar atendimento
            </button>
          )}
        </div>
      </div>
      {isBusy && (
        <p className="conversation-contact-notice" role="status">
          Atualizando atendimento...
        </p>
      )}
      {visibleNotice && (
        <p
          className={
            visibleNotice.error
              ? "inline-error conversation-attendance-error"
              : "conversation-contact-notice"
          }
          role={visibleNotice.error ? "alert" : "status"}
        >
          {visibleNotice.text}
        </p>
      )}
      {modal && target && (
        <dialog
          ref={dialogRef}
          className="modal conversation-contact-modal"
          aria-labelledby="conversation-attendance-title"
          onCancel={(event) => {
            event.preventDefault();
            if (!busyRef.current) setModal(null);
          }}
          onClick={(event) => {
            if (event.target !== event.currentTarget || busyRef.current) return;
            const bounds = event.currentTarget.getBoundingClientRect();
            if (
              event.clientX < bounds.left ||
              event.clientX > bounds.right ||
              event.clientY < bounds.top ||
              event.clientY > bounds.bottom
            )
              setModal(null);
          }}
        >
          <header className="modal-header">
            <div>
              <h2 id="conversation-attendance-title">{titles[modal.action]}</h2>
              <p>
                {modal.action === "assign"
                  ? "Selecione outro usuário ativo para assumir a responsabilidade."
                  : "Confirme a alteração de situação desta conversa."}
              </p>
            </div>
            <button
              className="icon-button"
              aria-label="Fechar"
              disabled={isBusy}
              type="button"
              onClick={() => setModal(null)}
            >
              <Icon name="close" size={18} />
            </button>
          </header>
          <form
            onSubmit={(event: FormEvent<HTMLFormElement>) => {
              event.preventDefault();
              void perform(modal.action, target, selectedUser?.id);
            }}
          >
            <div className="modal-body">
              {visibleNotice?.error && (
                <div className="form-error" role="alert">
                  {visibleNotice.text}
                </div>
              )}
              {!modalAllowed && (
                <div className="form-error" role="alert">
                  A situação ou sua permissão mudou. Feche esta janela e confira
                  os dados atualizados.
                </div>
              )}
              {modal.action === "assign" ? (
                <>
                  <div className="form-field">
                    <label htmlFor="attendance-user">Novo responsável</label>
                    <select
                      autoFocus
                      id="attendance-user"
                      value={selectedUserId}
                      disabled={
                        isBusy || usersLoading || !!usersError || !modalAllowed
                      }
                      onChange={(event) =>
                        setSelectedUserId(event.target.value)
                      }
                    >
                      <option value="">
                        {usersLoading
                          ? "Carregando usuários..."
                          : "Selecione um usuário"}
                      </option>
                      {availableUsers.map((candidate) => (
                        <option key={candidate.id} value={candidate.id}>
                          {candidate.username}
                        </option>
                      ))}
                    </select>
                  </div>
                  {usersLoading && (
                    <p
                      className="conversation-contact-confirmation"
                      role="status"
                    >
                      Carregando usuários ativos...
                    </p>
                  )}
                  {usersError && (
                    <div className="form-error" role="alert">
                      {usersError}{" "}
                      <button
                        className="secondary-button"
                        type="button"
                        disabled={isBusy}
                        onClick={() => {
                          setUsersError("");
                          setUsersLoading(true);
                          setRetryUsers((value) => value + 1);
                        }}
                      >
                        Tentar novamente
                      </button>
                    </div>
                  )}
                  {!usersLoading &&
                    !usersError &&
                    availableUsers.length === 0 && (
                      <p
                        className="conversation-contact-confirmation"
                        role="status"
                      >
                        Nenhum outro usuário ativo disponível.
                      </p>
                    )}
                  {selectedUser && (
                    <p className="conversation-contact-confirmation">
                      Transferir este atendimento para{" "}
                      <strong>{selectedUser.username}</strong>?
                    </p>
                  )}
                </>
              ) : (
                <p className="conversation-contact-confirmation">
                  {modal.action === "claim"
                    ? "Iniciar este atendimento? Você será o responsável por esta conversa."
                    : modal.action === "finish"
                      ? "Finalizar este atendimento? As mensagens e o contato vinculado serão preservados."
                      : "Reabrir este atendimento? A conversa voltará a aguardar atendimento, sem responsável."}
                </p>
              )}
            </div>
            <footer className="modal-footer">
              <button
                autoFocus={modal.action !== "assign"}
                className="secondary-button"
                type="button"
                disabled={isBusy}
                onClick={() => setModal(null)}
              >
                Cancelar
              </button>
              <button
                className={`primary-button${modal.action === "claim" ? " conversation-start-action" : ""}`}
                type="submit"
                disabled={
                  isBusy ||
                  !modalAllowed ||
                  (modal.action === "assign" &&
                    (usersLoading || !!usersError || !selectedUser))
                }
              >
                {isBusy
                  ? "Atualizando..."
                  : modal.action === "assign"
                    ? "Confirmar transferência"
                    : modal.action === "claim"
                      ? "Confirmar início"
                      : modal.action === "finish"
                        ? "Confirmar finalização"
                        : "Confirmar reabertura"}
              </button>
            </footer>
          </form>
        </dialog>
      )}
    </>
  );
}
