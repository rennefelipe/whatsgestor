export interface OrganizationType {
  id: string;
  name: string;
  isActive: boolean;
}

export interface Organization {
  id: string;
  name: string;
  organizationTypeId: string;
  parentOrganizationId: string | null;
  isActive: boolean;
  organizationType?: OrganizationType;
  parentOrganization?: Organization | null;
}

export interface ContactType {
  id: string;
  name: string;
  isActive: boolean;
}

export interface Contact {
  id: string;
  organizationId: string | null;
  contactTypeId: string;
  storeName: string | null;
  contactName: string;
  phone: string;
  email: string | null;
  isActive: boolean;
  organization: Organization | null;
  contactType: ContactType;
}

export type ContactDisplayField =
  | "group"
  | "shopping"
  | "store"
  | "contactType"
  | "contactName"
  | (string & {});

export interface ContactDisplaySetting {
  id: string;
  fieldKey: ContactDisplayField;
  isVisible: boolean;
  displayOrder: number;
}

export interface ContactPayload {
  organizationId: string | null;
  contactTypeId: string;
  storeName: string | null;
  contactName: string;
  phone: string;
  email: string | null;
}

export interface ApiErrorPayload {
  message?: string | string[];
  error?: string;
}

export interface AuthenticatedUser {
  id: string;
  username: string;
  isAdmin: boolean;
  canDelete: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface LoginResponse {
  accessToken: string;
  user: AuthenticatedUser;
}

export interface CreateUserPayload {
  username: string;
  password: string;
  isAdmin: boolean;
  canDelete: boolean;
  isActive: boolean;
}

export interface UpdateUserPayload {
  username?: string;
  password?: string;
  isAdmin?: boolean;
  canDelete?: boolean;
  isActive?: boolean;
}

export type WhatsappConnectionStatus =
  | "disconnected"
  | "connecting"
  | "qr_ready"
  | "connected"
  | "reconnecting"
  | "error";

export interface WhatsappConnection {
  id: string;
  name: string;
  phoneNumber: string | null;
  status: WhatsappConnectionStatus;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  lastConnectedAt: string | null;
  lastDisconnectedAt: string | null;
}

export interface WhatsappConversation {
  id: string;
  connectionId: string;
  remoteJid: string;
  contactName: string | null;
  contactId: string | null;
  contact: Pick<Contact, "id" | "contactName"> | null;
  attendanceStatus: "waiting" | "in_progress" | "finished";
  assignedUserId: string | null;
  assignedUser: Pick<AuthenticatedUser, "id" | "username"> | null;
  attendanceStartedAt: string | null;
  attendanceFinishedAt: string | null;
  lastMessageAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WhatsappMessageMedia {
  id: string;
  kind: "image" | "document" | "audio";
  availability: "pending" | "ready" | "failed";
  mimeType: string;
  originalName: string | null;
  sizeBytes: number | null;
  durationSeconds: number | null;
}

export interface WhatsappMessage {
  media?: WhatsappMessageMedia | null;
  id: string;
  conversationId: string;
  whatsappMessageId: string;
  fromMe: boolean;
  messageType: string;
  textContent: string | null;
  messageTimestamp: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface WhatsappConnectionStatusResponse {
  id: string;
  status: WhatsappConnectionStatus;
  phoneNumber: string | null;
  lastConnectedAt: string | null;
  lastDisconnectedAt: string | null;
}

export interface WhatsappConnectionQrResponse {
  qrCode: string;
  expiresAt: string;
}
