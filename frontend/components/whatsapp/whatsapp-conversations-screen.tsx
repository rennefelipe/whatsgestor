"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import {
  getWhatsappConversationMessages,
  getWhatsappConversations,
  sendWhatsappText,
} from "@/services/api/whatsapp-conversations";
import { getWhatsappConnections } from "@/services/api/whatsapp-connections";
import type {
  WhatsappConnection,
  WhatsappConversation,
  WhatsappMessage,
} from "@/types/api";
import { ApiRequestError } from "@/services/api/client";
import { Icon } from "../icons";
import { ConversationMedia } from "./conversation-media";
import { ConversationContactModal } from "./conversation-contact-modal";
import { ConversationAttendanceControls } from "./conversation-attendance-controls";
import {
  attendanceLabel,
  attendanceFields,
  canSendConversationMessage,
} from "./conversation-attendance";
import { useMessageScroll } from "./use-message-scroll";
import { useConversationSplit } from "./use-conversation-split";
import { ProfileAvatar } from "../profile-avatar";
import { AttachmentComposer } from "./attachment-composer";
import { AudioRecorder } from "./audio-recorder";
import { useAuth } from "../auth/auth-provider";

import {
  attendanceCategories,
  categoryAfterAttendanceUpdate,
  conversationName,
  conversationPhone,
  conversationPreview,
  filterConversations,
  matchesConversationSearch,
  type AttendanceCategory,
} from "./conversation-presentation";

const CONVERSATION_PAGE_SIZE = 50;
const MESSAGE_PAGE_SIZE = 50;
const CONVERSATION_POLL_MS = 10_000;
const MESSAGE_POLL_MS = 5_000;

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Não foi possível carregar as informações.";
}

function messageDate(message: WhatsappMessage): number {
  return new Date(message.messageTimestamp ?? message.createdAt).getTime();
}

function mergeMessages(
  current: WhatsappMessage[],
  incoming: WhatsappMessage[],
): WhatsappMessage[] {
  const byId = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()].sort(
    (left, right) => messageDate(left) - messageDate(right),
  );
}

function displayTime(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function displayActivity(value: string | null): string {
  if (!value) return "Sem atividade";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Sem atividade";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function conversationConnectionName(
  conversation: WhatsappConversation,
  connections: WhatsappConnection[],
): string {
  return (
    connections.find(
      (connection) => connection.id === conversation.connectionId,
    )?.name ?? "Conexão WhatsApp"
  );
}

export function WhatsappConversationsScreen({
  isVisible,
}: Readonly<{ isVisible: boolean }>) {
  const {
    layoutRef,
    style: splitStyle,
    separator,
    reset: resetSplit,
  } = useConversationSplit(isVisible);
  const [connections, setConnections] = useState<WhatsappConnection[]>([]);
  const [conversations, setConversations] = useState<WhatsappConversation[]>(
    [],
  );
  const [selectedConversation, setSelectedConversation] =
    useState<WhatsappConversation | null>(null);
  const [messages, setMessages] = useState<WhatsappMessage[]>([]);
  const { user } = useAuth();
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [attachmentOccupied, setAttachmentOccupied] = useState(true);
  const [audioOccupied, setAudioOccupied] = useState(false);
  const [connectionFilter, setConnectionFilter] = useState("");
  const [category, setCategory] = useState<AttendanceCategory>("waiting");
  const [search, setSearch] = useState("");
  const categoryRef = useRef<AttendanceCategory>("waiting");
  const searchRef = useRef("");
  const queryRevision = useRef(0);
  const [attendanceNotice, setAttendanceNotice] = useState("");
  const [conversationPage, setConversationPage] = useState(1);
  const [conversationTotal, setConversationTotal] = useState(0);
  const [messagePage, setMessagePage] = useState(1);
  const [messageTotal, setMessageTotal] = useState(0);
  const [text, setText] = useState("");
  const [conversationsError, setConversationsError] = useState("");
  const [messagesError, setMessagesError] = useState("");
  const [connectionsError, setConnectionsError] = useState("");
  const [sendError, setSendError] = useState("");
  const [isLoadingConversations, setIsLoadingConversations] = useState(true);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showConversationOnMobile, setShowConversationOnMobile] =
    useState(false);
  const [contactModal, setContactModal] = useState<{
    conversation: WhatsappConversation;
    mode: "link" | "unlink";
  } | null>(null);
  const [contactNotice, setContactNotice] = useState<{
    id: string;
    message: string;
  } | null>(null);
  const contactRevision = useRef(0);
  const contactUpdates = useRef(
    new Map<
      string,
      {
        revision: number;
        contactId: WhatsappConversation["contactId"];
        contact: WhatsappConversation["contact"];
      }
    >(),
  );
  const attendanceRevision = useRef(0);
  const attendanceUpdates = useRef(
    new Map<
      string,
      {
        revision: number;
        fields: ReturnType<typeof attendanceFields>;
      }
    >(),
  );
  const conversationsBusy = useRef<{
    signal: AbortSignal;
    revision: number;
  } | null>(null);
  const messagesBusy = useRef(false);
  const olderMessagesBusy = useRef(false);
  const conversationsRef = useRef(conversations);
  const selectedConversationRef = useRef<WhatsappConversation | null>(null);

  const reconcileSelection = useCallback((items: WhatsappConversation[]) => {
    const visible = filterConversations(
      items,
      categoryRef.current,
      searchRef.current,
    );
    const currentId = selectedConversationRef.current?.id;
    const selection =
      visible.find((item) => item.id === currentId) ?? visible[0] ?? null;
    if (selection?.id !== currentId) {
      setMessages([]);
      setMessageTotal(0);
      setMessagePage(1);
    }
    if (!selection) setShowConversationOnMobile(false);
    selectedConversationRef.current = selection;
    setSelectedConversation(selection);
  }, []);

  const refreshConversations = useCallback(
    async (signal: AbortSignal, initial = false) => {
      const requestRevision = queryRevision.current;
      const busy = conversationsBusy.current;
      if (
        signal.aborted ||
        (busy && !busy.signal.aborted && busy.revision === requestRevision)
      )
        return;
      const request = { signal, revision: requestRevision };
      conversationsBusy.current = request;
      const requestContactRevision = contactRevision.current;
      const requestAttendanceRevision = attendanceRevision.current;
      if (initial) setIsLoadingConversations(true);
      setConversationsError("");
      try {
        const result = await getWhatsappConversations(
          {
            connectionId: connectionFilter || undefined,
            page: conversationPage,
            pageSize: CONVERSATION_PAGE_SIZE,
          },
          signal,
        );
        if (signal.aborted || requestRevision !== queryRevision.current) return;
        // A response started before a successful PATCH must not undo its contact link.
        // Preserve the deterministic backend order, established before pagination.
        const ordered = result.items.map((item) => {
          const update = contactUpdates.current.get(item.id);
          const withContact =
            update && update.revision > requestContactRevision
              ? {
                  ...item,
                  contactId: update.contactId,
                  contact: update.contact,
                }
              : item;
          const attendance = attendanceUpdates.current.get(item.id);
          return attendance && attendance.revision > requestAttendanceRevision
            ? { ...withContact, ...attendance.fields }
            : withContact;
        });
        conversationsRef.current = ordered;
        setConversations(ordered);
        setConversationTotal(result.total);
        reconcileSelection(ordered);
      } catch (error) {
        if (!signal.aborted && requestRevision === queryRevision.current)
          setConversationsError(errorMessage(error));
      } finally {
        if (conversationsBusy.current === request)
          conversationsBusy.current = null;
        if (
          !signal.aborted &&
          requestRevision === queryRevision.current &&
          initial
        )
          setIsLoadingConversations(false);
      }
    },
    [connectionFilter, conversationPage, reconcileSelection],
  );

  useEffect(() => {
    if (!isVisible) return;
    const controller = new AbortController();
    let connectionsBusy = false;
    const refreshConnections = async () => {
      if (connectionsBusy || controller.signal.aborted) return;
      connectionsBusy = true;
      try {
        setConnections(await getWhatsappConnections(controller.signal));
        setConnectionsError("");
      } catch (error) {
        if (!controller.signal.aborted)
          setConnectionsError(errorMessage(error));
      } finally {
        connectionsBusy = false;
      }
    };
    void refreshConnections();
    const connectionInterval = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshConnections();
    }, 30_000);
    return () => {
      controller.abort();
      window.clearInterval(connectionInterval);
    };
  }, [isVisible]);

  useEffect(() => {
    if (!isVisible) return;
    const controller = new AbortController();
    const initialTimer = window.setTimeout(
      () => void refreshConversations(controller.signal, true),
      0,
    );
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible")
        void refreshConversations(controller.signal);
    }, CONVERSATION_POLL_MS);
    return () => {
      controller.abort();
      window.clearTimeout(initialTimer);
      window.clearInterval(interval);
    };
  }, [isVisible, refreshConversations]);

  const refreshSelectedMessages = useCallback(
    async (signal: AbortSignal, initial = false) => {
      const selected = selectedConversationRef.current;
      if (!selected || messagesBusy.current || signal.aborted) return;
      messagesBusy.current = true;
      if (initial) setIsLoadingMessages(true);
      setMessagesError("");
      try {
        const firstPage = await getWhatsappConversationMessages(
          selected.id,
          { page: 1, pageSize: MESSAGE_PAGE_SIZE },
          signal,
        );
        if (
          signal.aborted ||
          selectedConversationRef.current?.id !== selected.id
        )
          return;
        const lastPage = Math.max(
          1,
          Math.ceil(firstPage.total / MESSAGE_PAGE_SIZE),
        );
        const latest =
          lastPage === 1
            ? firstPage
            : await getWhatsappConversationMessages(
                selected.id,
                { page: lastPage, pageSize: MESSAGE_PAGE_SIZE },
                signal,
              );
        if (
          signal.aborted ||
          selectedConversationRef.current?.id !== selected.id
        )
          return;
        setMessages((current) => mergeMessages(current, latest.items));
        setMessagePage(lastPage);
        setMessageTotal(latest.total);
      } catch (error) {
        if (
          !signal.aborted &&
          selectedConversationRef.current?.id === selected.id
        )
          setMessagesError(errorMessage(error));
      } finally {
        messagesBusy.current = false;
        if (
          !signal.aborted &&
          selectedConversationRef.current?.id === selected.id &&
          initial
        )
          setIsLoadingMessages(false);
      }
    },
    [],
  );

  const selectedConversationId = selectedConversation?.id;
  const {
    viewportRef,
    contentRef,
    showLatest,
    onScroll: onMessageScroll,
    latest: scrollToLatest,
    followSentMessage,
    preserveOlderMessages,
  } = useMessageScroll(selectedConversationId, messages, isLoadingMessages);
  useEffect(() => {
    if (!isVisible || !selectedConversationId) return;
    const selectedId = selectedConversationId;
    const controller = new AbortController();
    messagesBusy.current = false;
    const initialTimer = window.setTimeout(
      () => void refreshSelectedMessages(controller.signal, true),
      0,
    );
    const interval = window.setInterval(() => {
      if (
        document.visibilityState === "visible" &&
        selectedConversationRef.current?.id === selectedId
      ) {
        void refreshSelectedMessages(controller.signal);
      }
    }, MESSAGE_POLL_MS);
    return () => {
      controller.abort();
      window.clearTimeout(initialTimer);
      window.clearInterval(interval);
    };
  }, [isVisible, selectedConversationId, refreshSelectedMessages]);

  const selectedConnection = selectedConversation
    ? connections.find(
        (connection) => connection.id === selectedConversation.connectionId,
      )
    : undefined;
  const canSend = selectedConnection?.status === "connected";
  const canRespond =
    !!selectedConversation &&
    canSend &&
    !!selectedConnection?.isActive &&
    canSendConversationMessage(user, selectedConversation);
  const sendRestriction = !selectedConversation
    ? ""
    : !canSend || !selectedConnection?.isActive
      ? "Para responder, conecte e ative esta conexão WhatsApp."
      : selectedConversation.attendanceStatus === "waiting"
        ? "Inicie o atendimento para responder a esta conversa."
        : selectedConversation.attendanceStatus === "finished"
          ? "Reabra o atendimento para responder a esta conversa."
          : !user?.isActive
            ? "Seu usuário não está ativo para responder."
            : !user.isAdmin &&
                selectedConversation.assignedUserId !== user.id
              ? "Somente o responsável pelo atendimento ou um administrador pode responder."
              : "";

  async function loadOlderMessages() {
    if (!selectedConversation || messagePage <= 1 || olderMessagesBusy.current)
      return;
    olderMessagesBusy.current = true;
    setIsLoadingOlder(true);
    setMessagesError("");
    try {
      const previousPage = messagePage - 1;
      const result = await getWhatsappConversationMessages(
        selectedConversation.id,
        { page: previousPage, pageSize: MESSAGE_PAGE_SIZE },
      );
      if (selectedConversationRef.current?.id !== selectedConversation.id)
        return;
      preserveOlderMessages();
      setMessages((current) => mergeMessages(current, result.items));
      setMessagePage(previousPage);
      setMessageTotal(result.total);
    } catch (error) {
      setMessagesError(errorMessage(error));
    } finally {
      olderMessagesBusy.current = false;
      setIsLoadingOlder(false);
    }
  }

  async function handleSend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const conversation = selectedConversation;
    const textContent = text;
    if (
      !conversation ||
      !textContent.trim() ||
      !canRespond ||
      isSending ||
      attachmentBusy ||
      audioOccupied
    )
      return;
    setIsSending(true);
    setSendError("");
    try {
      const message = await sendWhatsappText(conversation.id, { textContent });
      if (selectedConversationRef.current?.id === conversation.id) {
        followSentMessage();
        setMessages((current) => mergeMessages(current, [message]));
        setMessageTotal((current) => current + 1);
        setText("");
      }
      const controller = new AbortController();
      void refreshConversations(controller.signal);
    } catch (error) {
      const apiError = error instanceof ApiRequestError ? error : null;
      const possibleAcceptance =
        apiError === null || apiError.status === 0 || apiError.status >= 500;
      setSendError(
        `${errorMessage(error)}${
          possibleAcceptance
            ? " O envio pode ter sido aceito antes da falha; verifique a conversa antes de tentar novamente."
            : " Verifique a conversa antes de tentar novamente."
        }`,
      );
    } finally {
      setIsSending(false);
    }
  }

  function handleMediaSent(message: WhatsappMessage) {
    if (selectedConversationRef.current?.id === message.conversationId) {
      followSentMessage();
      setMessages((current) => mergeMessages(current, [message]));
      void refreshSelectedMessages(new AbortController().signal);
    }
    void refreshConversations(new AbortController().signal);
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  function reloadAll() {
    if (isRefreshing) return;
    setIsRefreshing(true);
    const controller = new AbortController();
    void Promise.all([
      refreshConversations(controller.signal),
      refreshSelectedMessages(controller.signal),
      getWhatsappConnections(controller.signal)
        .then((items) => {
          setConnections(items);
          setConnectionsError("");
        })
        .catch((error: unknown) => setConnectionsError(errorMessage(error))),
    ]).finally(() => setIsRefreshing(false));
  }

  function clearConversationPage() {
    queryRevision.current += 1;
    setIsLoadingConversations(true);
    setConversations([]);
    conversationsRef.current = [];
    setConversationTotal(0);
    selectedConversationRef.current = null;
    setSelectedConversation(null);
    setMessages([]);
    setMessageTotal(0);
    setMessagePage(1);
  }

  function handleConnectionFilterChange(value: string) {
    clearConversationPage();
    setConversationPage(1);
    setConnectionFilter(value);
  }

  function changePage(page: number) {
    clearConversationPage();
    setConversationPage(page);
  }

  function changeCategory(value: AttendanceCategory) {
    categoryRef.current = value;
    setCategory(value);
    setAttendanceNotice("");
    reconcileSelection(conversationsRef.current);
  }

  function changeSearch(value: string) {
    searchRef.current = value;
    setSearch(value);
    reconcileSelection(conversationsRef.current);
  }

  function handleContactSaved(updated: WhatsappConversation) {
    const revision = ++contactRevision.current;
    const association = {
      contactId: updated.contactId,
      contact: updated.contact,
    };
    contactUpdates.current.set(updated.id, { revision, ...association });
    const next = conversationsRef.current.map((item) =>
      item.id === updated.id ? { ...item, ...association } : item,
    );
    conversationsRef.current = next;
    setConversations(next);
    const selected = selectedConversationRef.current;
    if (selected?.id === updated.id) {
      const nextSelected = { ...selected, ...association };
      selectedConversationRef.current = nextSelected;
      setSelectedConversation(nextSelected);
    }
    setContactNotice({
      id: updated.id,
      message: updated.contactId
        ? "Contato vinculado com sucesso."
        : "Contato desvinculado com sucesso.",
    });
    setContactModal(null);
    reconcileSelection(next);
  }

  function handleAttendanceUpdated(updated: WhatsappConversation) {
    const nextCategory = categoryAfterAttendanceUpdate(
      categoryRef.current,
      selectedConversationRef.current?.id,
      updated,
    );
    if (nextCategory !== categoryRef.current) {
      categoryRef.current = nextCategory;
      setCategory(nextCategory);
    }
    const fields = attendanceFields(updated);
    const revision = ++attendanceRevision.current;
    attendanceUpdates.current.set(updated.id, { revision, fields });
    const next = conversationsRef.current.map((item) =>
      item.id === updated.id ? { ...item, ...fields } : item,
    );
    conversationsRef.current = next;
    setConversations(next);
    setAttendanceNotice(
      conversationName(updated) +
        ": " +
        attendanceLabel(updated.attendanceStatus) +
        ".",
    );
    reconcileSelection(next);
  }

  function selectConversation(conversation: WhatsappConversation) {
    if (selectedConversationRef.current?.id !== conversation.id) {
      setMessages([]);
      setMessageTotal(0);
      setMessagePage(1);
    }
    selectedConversationRef.current = conversation;
    setSelectedConversation(conversation);
    setShowConversationOnMobile(true);
  }

  const visibleConversations = filterConversations(
    conversations,
    category,
    search,
  );
  const counts = Object.fromEntries(
    attendanceCategories.map(({ status }) => [
      status,
      conversations.filter(
        (item) =>
          (status === "all" || item.attendanceStatus === status) &&
          matchesConversationSearch(item, search),
      ).length,
    ]),
  );
  const totalPages = Math.max(
    1,
    Math.ceil(conversationTotal / CONVERSATION_PAGE_SIZE),
  );

  if (!isVisible) return null;

  return (
    <main className="main-content conversations-content">
      <header className="conversation-controls">
        <div className="conversation-controls-heading">
          <h1>Conversas</h1>
          <span className="conversation-count" role="status">
            {isLoadingConversations
              ? "Carregando..."
              : `${conversationTotal} ${conversationTotal === 1 ? "conversa" : "conversas"}`}
          </span>
        </div>
        <div className="conversations-toolbar">
          <label className="conversation-connection-filter">
            <span className="sr-only">Conexão WhatsApp</span>
            <select
              className="filter-select"
              onChange={(event) =>
                handleConnectionFilterChange(event.target.value)
              }
              value={connectionFilter}
            >
              <option value="">Todas as conexões</option>
              {connections.map((connection) => (
                <option key={connection.id} value={connection.id}>
                  {connection.name}
                </option>
              ))}
            </select>
          </label>
          <label className="conversation-search">
            <span className="sr-only">Buscar nesta página</span>
            <input
              type="search"
              placeholder="Buscar nome ou telefone nesta página"
              aria-describedby="conversation-filter-scope"
              value={search}
              onChange={(event) => changeSearch(event.target.value)}
            />
          </label>
          <button
            className="conversation-refresh"
            disabled={isRefreshing}
            onClick={reloadAll}
            type="button"
            aria-label={
              isRefreshing ? "Atualizando conversas" : "Atualizar conversas"
            }
            title="Atualizar conversas"
          >
            <Icon name="refresh" size={17} />
          </button>
        </div>
        <nav
          className="conversation-categories"
          aria-label="Situação do atendimento"
          aria-describedby="conversation-filter-scope"
          title="Abas, contadores e busca consideram apenas a página atual."
        >
          {attendanceCategories.map(({ status, label, title }) => (
            <button
              key={status}
              type="button"
              aria-pressed={category === status}
              title={title}
              className={[
                "conversation-category",
                status,
                category === status ? "active" : "",
              ].join(" ")}
              onClick={() => changeCategory(status)}
            >
              <span>{label}</span>
              <span className="conversation-category-count">
                {isLoadingConversations ? "—" : counts[status]}
              </span>
            </button>
          ))}
        </nav>
        <p className="sr-only" id="conversation-filter-scope">
          Abas, contadores e busca consideram apenas esta página
          {search.trim() ? " e a busca atual" : ""}. Consulte as demais páginas
          para ver outras conversas.
        </p>
      </header>
      {connectionsError && (
        <div className="inline-error" role="alert">
          Não foi possível carregar as conexões WhatsApp. {connectionsError}
        </div>
      )}
      {conversationsError && (
        <div className="inline-error" role="alert">
          Não foi possível carregar as conversas. {conversationsError}
        </div>
      )}
      {attendanceNotice && (
        <p className="conversation-attendance-page-notice" role="status">
          {attendanceNotice}
        </p>
      )}

      <section
        className={`conversations-layout${
          showConversationOnMobile ? " mobile-show-chat" : " mobile-show-list"
        }`}
        ref={layoutRef}
        style={splitStyle}
        aria-label="Atendimento WhatsApp"
      >
        <aside id="conversation-list" className="conversation-list-panel">
          <div className="conversation-list-heading">
            <strong>
              {
                attendanceCategories.find((item) => item.status === category)
                  ?.title
              }
            </strong>
            <span>{visibleConversations.length} nesta página</span>
            <button
              className="split-reset icon-button"
              type="button"
              onClick={resetSplit}
              title="Restaurar largura padrão"
              aria-label="Restaurar largura padrão"
            >
              <Icon name="refresh" size={14} />
            </button>
          </div>
          {isLoadingConversations ? (
            <div className="conversation-list-state" role="status">
              Carregando conversas...
            </div>
          ) : visibleConversations.length === 0 ? (
            <div className="conversation-list-state">
              <strong>Nenhuma conversa encontrada</strong>
              <span>
                Nenhuma conversa corresponde à categoria e à busca nesta página.
              </span>
            </div>
          ) : (
            <div className="conversation-items">
              {visibleConversations.map((conversation) => (
                <button
                  aria-current={
                    selectedConversation?.id === conversation.id
                      ? "true"
                      : undefined
                  }
                  className={`conversation-item ${conversation.attendanceStatus}${
                    selectedConversation?.id === conversation.id
                      ? " selected"
                      : ""
                  }`}
                  key={conversation.id}
                  onClick={() => selectConversation(conversation)}
                  type="button"
                >
                  <ProfileAvatar
                    className="conversation-avatar"
                    name={conversationName(conversation)}
                    conversationId={conversation.id}
                  />
                  <span className="conversation-item-copy">
                    <strong>{conversationName(conversation)}</strong>
                    {conversation.id === selectedConversation?.id &&
                      !isLoadingMessages &&
                      conversationPreview(conversation, messages) && (
                        <span
                          className="conversation-message-preview"
                          title={conversationPreview(conversation, messages)}
                        >
                          {conversationPreview(conversation, messages)}
                        </span>
                      )}
                    {conversationPhone(conversation) && (
                      <span>{conversationPhone(conversation)}</span>
                    )}
                    <span>
                      {conversationConnectionName(conversation, connections)}
                    </span>
                    <span
                      className="conversation-attendance-summary"
                      title={[
                        attendanceLabel(conversation.attendanceStatus),
                        conversation.assignedUser?.username,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    >
                      {attendanceLabel(conversation.attendanceStatus)}
                      {conversation.assignedUser?.username &&
                        ` · ${conversation.assignedUser.username}`}
                    </span>
                  </span>
                  <time className="conversation-item-time">
                    {displayActivity(
                      conversation.lastMessageAt ?? conversation.createdAt,
                    )}
                  </time>
                </button>
              ))}
            </div>
          )}
          <div
            className="conversation-pagination"
            aria-label="Paginação de conversas"
          >
            <button
              className="conversation-contact-action"
              type="button"
              disabled={conversationPage <= 1 || isLoadingConversations}
              onClick={() => changePage(conversationPage - 1)}
            >
              Anterior
            </button>
            <span>
              Página {conversationPage} de {totalPages}
            </span>
            <button
              className="conversation-contact-action"
              type="button"
              disabled={
                conversationPage >= totalPages || isLoadingConversations
              }
              onClick={() => changePage(conversationPage + 1)}
            >
              Próxima
            </button>
          </div>
        </aside>

        {separator}
        <section
          id="conversation-chat"
          className="conversation-chat-panel"
          aria-label="Histórico"
        >
          {!selectedConversation ? (
            <div className="conversation-chat-empty">
              <Icon name="conversations" size={28} />
              <strong>Selecione uma conversa</strong>
              <span>Escolha uma conversa para consultar as mensagens.</span>
            </div>
          ) : (
            <>
              <header className="conversation-chat-header">
                <button
                  aria-label="Voltar para a lista de conversas"
                  className="conversation-mobile-back"
                  onClick={() => setShowConversationOnMobile(false)}
                  type="button"
                >
                  <span aria-hidden="true">‹</span>
                  <span>Conversas</span>
                </button>
                <ProfileAvatar
                  className="conversation-avatar"
                  name={conversationName(selectedConversation)}
                  conversationId={selectedConversation.id}
                />
                <div className="conversation-contact-identity">
                  <strong>{conversationName(selectedConversation)}</strong>
                  <span>
                    {selectedConnection?.name ?? "Conexão WhatsApp"}
                    {" · "}
                    {!selectedConnection
                      ? "Status indisponível"
                      : canSend
                        ? "Conectada"
                        : "Indisponível"}
                  </span>
                </div>
                <button
                  className="conversation-contact-action"
                  aria-label={
                    selectedConversation.contactId
                      ? "Desvincular contato"
                      : "Vincular contato"
                  }
                  title={
                    selectedConversation.contactId
                      ? "Desvincular contato"
                      : "Vincular contato"
                  }
                  onClick={() =>
                    setContactModal({
                      conversation: selectedConversation,
                      mode: selectedConversation.contactId ? "unlink" : "link",
                    })
                  }
                  type="button"
                >
                  <Icon
                    name="contacts"
                    size={16}
                    className="conversation-contact-button-icon"
                  />
                  <span className="conversation-contact-button-label">
                    {selectedConversation.contactId
                      ? "Desvincular contato"
                      : "Vincular contato"}
                  </span>
                </button>
              </header>
              {contactNotice?.id === selectedConversation.id && (
                <p className="conversation-contact-notice" role="status">
                  {contactNotice.message}
                </p>
              )}

              <ConversationAttendanceControls
                conversation={selectedConversation}
                onUpdated={handleAttendanceUpdated}
              />

              {messagesError && (
                <div
                  className="inline-error conversation-message-error"
                  role="alert"
                >
                  Não foi possível carregar as mensagens. {messagesError}
                </div>
              )}

              <div className="conversation-history">
                <div
                  className="conversation-messages"
                  aria-live="polite"
                  aria-label="Mensagens da conversa"
                  tabIndex={0}
                  ref={viewportRef}
                  onScroll={onMessageScroll}
                >
                  <div
                    className="conversation-message-content"
                    ref={contentRef}
                  >
                    {messagePage > 1 && (
                      <button
                        className="conversation-load-older"
                        disabled={isLoadingOlder}
                        onClick={loadOlderMessages}
                        type="button"
                      >
                        {isLoadingOlder
                          ? "Carregando..."
                          : "Carregar mensagens mais antigas"}
                      </button>
                    )}
                    {isLoadingMessages ? (
                      <div className="conversation-chat-empty" role="status">
                        Carregando mensagens...
                      </div>
                    ) : messages.length === 0 ? (
                      <div className="conversation-chat-empty">
                        Ainda não há mensagens nesta conversa.
                      </div>
                    ) : (
                      messages.map((message) => (
                        <article
                          className={`conversation-message${
                            message.fromMe ? " outgoing" : " incoming"
                          }`}
                          key={message.id}
                          data-message-id={message.id}
                        >
                          {message.messageType !== "text" && (
                            <ConversationMedia message={message} />
                          )}
                          {(message.textContent ||
                            message.messageType === "text") && (
                            <p>
                              {message.textContent ||
                                "Mensagem sem texto disponível."}
                            </p>
                          )}
                          <time>
                            {displayTime(
                              message.messageTimestamp ?? message.createdAt,
                            )}
                          </time>
                        </article>
                      ))
                    )}
                    <span className="sr-only">
                      {messageTotal} mensagens nesta conversa
                    </span>
                  </div>
                </div>
                {showLatest && (
                  <button
                    className="conversation-go-latest"
                    type="button"
                    onClick={scrollToLatest}
                  >
                    Ir para a última mensagem
                  </button>
                )}
              </div>

              <form className="conversation-composer" onSubmit={handleSend}>
                {sendError && (
                  <div
                    className="inline-error conversation-send-error"
                    role="alert"
                  >
                    {sendError}
                  </div>
                )}
                {sendRestriction && (
                  <p className="conversation-send-hint">
                    {sendRestriction}
                  </p>
                )}
                <AttachmentComposer
                  key={selectedConversation.id + "/" + user?.id}
                  conversationId={selectedConversation.id}
                  allowed={canRespond && !isSending && !audioOccupied}
                  onBusy={setAttachmentBusy}
                  onOccupied={setAttachmentOccupied}
                  onSent={handleMediaSent}
                >
                  {({ button: attachmentButton, preview: attachmentPreview }) => (
                    <AudioRecorder
                      conversationId={selectedConversation.id}
                      allowed={
                        canRespond &&
                        !isSending &&
                        !attachmentBusy &&
                        !attachmentOccupied
                      }
                      onOccupied={setAudioOccupied}
                      onSent={handleMediaSent}
                    >
                      {({ button: audioButton, preview: audioPreview }) => (
                        <>
                          {attachmentPreview}
                          {audioPreview}
                          <div className="conversation-composer-row">
                            {attachmentButton}
                            {audioButton}
                            <textarea
                              aria-label="Escreva uma mensagem"
                              disabled={
                                !canRespond ||
                                isSending ||
                                attachmentBusy ||
                                audioOccupied
                              }
                              maxLength={4096}
                              onChange={(event) => setText(event.target.value)}
                              onKeyDown={handleComposerKeyDown}
                              placeholder={
                                canRespond
                                  ? "Escreva uma mensagem..."
                                  : "Envio indisponível neste atendimento"
                              }
                              rows={2}
                              value={text}
                            />
                            <button
                              className="primary-button"
                              disabled={
                                !canRespond ||
                                isSending ||
                                attachmentBusy ||
                                audioOccupied ||
                                !text.trim()
                              }
                              type="submit"
                            >
                              {isSending ? "Enviando..." : "Enviar"}
                            </button>
                          </div>
                        </>
                      )}
                    </AudioRecorder>
                  )}
                </AttachmentComposer>
                <span className="conversation-composer-note">
                  Enter para enviar · Shift+Enter para nova linha
                </span>
              </form>
            </>
          )}
        </section>
      </section>
      {contactModal && (
        <ConversationContactModal
          key={contactModal.conversation.id + contactModal.mode}
          conversation={contactModal.conversation}
          mode={contactModal.mode}
          onClose={() => setContactModal(null)}
          onSaved={handleContactSaved}
        />
      )}
    </main>
  );
}
