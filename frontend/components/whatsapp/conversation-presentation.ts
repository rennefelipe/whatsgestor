import type { WhatsappConversation, WhatsappMessage } from "@/types/api";
export const attendanceCategories = [
  { status: "all", label: "Todos", title: "Todas as conversas" },
  { status: "waiting", label: "Aguardando", title: "Aguardando atendimento" },
  { status: "in_progress", label: "Em atendimento", title: "Em atendimento" },
  { status: "finished", label: "Finalizados", title: "Finalizados" },
] as const;
export type AttendanceCategory =
  (typeof attendanceCategories)[number]["status"];
export function conversationName(conversation: WhatsappConversation): string {
  const name = (
    conversation.contact?.contactName ?? conversation.contactName
  )?.trim();
  return name && /[\p{L}\p{N}]/u.test(name) ? name : "Contato não identificado";
}
export function conversationPhone(conversation: WhatsappConversation): string {
  // Only direct phone JIDs supply phone numbers; never infer a phone from LID.
  return /^(\d+)@s\.whatsapp\.net$/.exec(conversation.remoteJid)?.[1] ?? "";
}
function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR");
}
export function matchesConversationSearch(
  conversation: WhatsappConversation,
  search: string,
): boolean {
  const query = search.trim();
  if (!query) return true;
  if (normalize(conversationName(conversation)).includes(normalize(query)))
    return true;
  const digits = query.replace(/\D/g, "");
  return (
    /^[+\d\s().-]+$/.test(query) &&
    !!digits &&
    conversationPhone(conversation).includes(digits)
  );
}
export function filterConversations(
  conversations: WhatsappConversation[],
  category: AttendanceCategory,
  search: string,
): WhatsappConversation[] {
  return conversations.filter(
    (conversation) =>
      (category === "all" || conversation.attendanceStatus === category) &&
      matchesConversationSearch(conversation, search),
  );
}

export function categoryAfterAttendanceUpdate(
  current: AttendanceCategory,
  selectedConversationId: string | undefined,
  updated: WhatsappConversation,
): AttendanceCategory {
  return current === "waiting" &&
    selectedConversationId === updated.id &&
    updated.attendanceStatus === "in_progress"
    ? "in_progress"
    : current;
}

export function conversationPreview(
  conversation: WhatsappConversation,
  messages: WhatsappMessage[],
): string {
  const latest = messages.at(-1);
  if (!latest?.textContent) return "";
  const timestamp = new Date(
    latest.messageTimestamp ?? latest.createdAt,
  ).getTime();
  if (
    conversation.lastMessageAt &&
    timestamp < new Date(conversation.lastMessageAt).getTime()
  )
    return "";
  return latest.textContent;
}
