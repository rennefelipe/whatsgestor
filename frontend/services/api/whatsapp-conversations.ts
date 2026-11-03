import type {
  PaginatedResponse,
  WhatsappConversation,
  WhatsappMessage,
} from "@/types/api";
import { apiRequest } from "./client";

export interface WhatsappConversationFilters {
  connectionId?: string;
  page?: number;
  pageSize?: number;
}

export interface SendWhatsappTextPayload {
  textContent: string;
}

function paginationQuery(query: {
  page?: number;
  pageSize?: number;
}): URLSearchParams {
  const params = new URLSearchParams();
  if (query.page !== undefined) params.set("page", String(query.page));
  if (query.pageSize !== undefined)
    params.set("pageSize", String(query.pageSize));
  return params;
}

export function getWhatsappConversations(
  filters: WhatsappConversationFilters = {},
  signal?: AbortSignal,
): Promise<PaginatedResponse<WhatsappConversation>> {
  const params = paginationQuery(filters);
  if (filters.connectionId) params.set("connectionId", filters.connectionId);
  const query = params.toString();
  return apiRequest<PaginatedResponse<WhatsappConversation>>(
    `/whatsapp-conversations${query ? `?${query}` : ""}`,
    { signal },
  );
}

export function getWhatsappConversationMessages(
  conversationId: string,
  query: { page?: number; pageSize?: number } = {},
  signal?: AbortSignal,
): Promise<PaginatedResponse<WhatsappMessage>> {
  const params = paginationQuery(query);
  const suffix = params.size ? `?${params.toString()}` : "";
  return apiRequest<PaginatedResponse<WhatsappMessage>>(
    `/whatsapp-conversations/${encodeURIComponent(conversationId)}/messages${suffix}`,
    { signal },
  );
}

export function sendWhatsappText(
  conversationId: string,
  payload: SendWhatsappTextPayload,
  attemptId: string,
): Promise<WhatsappMessage> {
  return apiRequest<WhatsappMessage>(
    `/whatsapp-conversations/${encodeURIComponent(conversationId)}/messages`,
    { method: "POST", headers:{"Idempotency-Key":attemptId}, body: JSON.stringify(payload) },
  );
}

export interface AttachmentAttempt {
  id: string;
  kind?: "image" | "document" | "audio";
  state:
    | "prepared"
    | "sending"
    | "confirmed"
    | "registered"
    | "uncertain"
    | "failed"
    | "reviewed";
  originalName?: string;
  message: WhatsappMessage | null;
}
function attachmentsPath(conversationId: string) {
  return `/whatsapp-conversations/${encodeURIComponent(conversationId)}/messages/attachments`;
}
export function sendWhatsappAttachment(
  conversationId: string,
  attemptId: string,
  file: File,
): Promise<WhatsappMessage> {
  const body = new FormData();
  body.append("file", file);
  return apiRequest(attachmentsPath(conversationId), {
    method: "POST",
    headers: { "Idempotency-Key": attemptId },
    body,
  });
}
export function sendWhatsappAudio(
  conversationId: string,
  attemptId: string,
  file: File,
): Promise<WhatsappMessage> {
  const body = new FormData();
  body.append("file", file);
  return apiRequest<WhatsappMessage>(
    `/whatsapp-conversations/${encodeURIComponent(conversationId)}/messages/audio`,
    {
      method: "POST",
      headers: { "Idempotency-Key": attemptId },
      body,
    },
  );
}
export function pendingWhatsappAttachment(
  conversationId: string,
): Promise<AttachmentAttempt | null> {
  return apiRequest(`${attachmentsPath(conversationId)}/pending`, {
    cache: "no-store",
  });
}
export function getWhatsappAttachmentAttempt(
  conversationId: string,
  id: string,
): Promise<AttachmentAttempt> {
  return apiRequest(
    `${attachmentsPath(conversationId)}/${encodeURIComponent(id)}`,
    { cache: "no-store" },
  );
}
export function reviewWhatsappAttachment(
  conversationId: string,
  id: string,
): Promise<AttachmentAttempt> {
  return apiRequest(
    `${attachmentsPath(conversationId)}/${encodeURIComponent(id)}/review`,
    { method: "POST" },
  );
}

export function updateWhatsappConversationContact(
  conversationId: string,
  contactId: string | null,
): Promise<WhatsappConversation> {
  return apiRequest<WhatsappConversation>(
    `/whatsapp-conversations/${encodeURIComponent(conversationId)}/contact`,
    { method: "PATCH", body: JSON.stringify({ contactId }) },
  );
}
export function getWhatsappConversation(
  conversationId: string,
  signal?: AbortSignal,
): Promise<WhatsappConversation> {
  return apiRequest<WhatsappConversation>(
    `/whatsapp-conversations/${encodeURIComponent(conversationId)}`,
    { signal },
  );
}

export function claimWhatsappAttendance(
  conversationId: string,
): Promise<WhatsappConversation> {
  return apiRequest<WhatsappConversation>(
    `/whatsapp-conversations/${encodeURIComponent(conversationId)}/attendance/claim`,
    { method: "POST" },
  );
}

export function finishWhatsappAttendance(
  conversationId: string,
): Promise<WhatsappConversation> {
  return apiRequest<WhatsappConversation>(
    `/whatsapp-conversations/${encodeURIComponent(conversationId)}/attendance/finish`,
    { method: "POST" },
  );
}

export function reopenWhatsappAttendance(
  conversationId: string,
): Promise<WhatsappConversation> {
  return apiRequest<WhatsappConversation>(
    `/whatsapp-conversations/${encodeURIComponent(conversationId)}/attendance/reopen`,
    { method: "POST" },
  );
}

export function assignWhatsappAttendance(
  conversationId: string,
  assignedUserId: string,
): Promise<WhatsappConversation> {
  return apiRequest<WhatsappConversation>(
    `/whatsapp-conversations/${encodeURIComponent(conversationId)}/attendance/assign`,
    { method: "PATCH", body: JSON.stringify({ assignedUserId }) },
  );
}
