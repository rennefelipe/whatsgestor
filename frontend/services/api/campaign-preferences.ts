import { apiRequest } from "./client";

export interface CampaignPreference {
  id: string;
  normalizedPhone: string | null;
  whatsappIdentity: string | null;
  connectionId: string | null;
  shoppingId: string | null;
  isActive: boolean;
  version: number;
  reason: string;
  createdAt: string;
  revokedAt: string | null;
}
export interface PreferenceEvent {
  id: string;
  action: "block" | "revoke";
  actorUsername: string;
  reason: string;
  createdAt: string;
  beforeState: string | null;
  afterState: string;
}
export interface PreferencePage {
  items: CampaignPreference[];
  total: number;
  page: number;
  pageSize: number;
  normalizedPhone: string | null;
  affectedContacts: number;
  identities: {
    conversationId: string;
    connectionId: string;
    whatsappIdentity: string;
  }[];
}
export const getCampaignPreferences = (
  contactId: string,
  page = 1,
  signal?: AbortSignal,
) =>
  apiRequest<PreferencePage>(
    `/contacts/${contactId}/campaign-preferences?page=${page}&pageSize=10`,
    { signal, cache: "no-store" },
  );
export const getAllCampaignPreferences = (page = 1, signal?: AbortSignal) =>
  apiRequest<PreferencePage>(
    `/contacts/campaign-preferences?page=${page}&pageSize=10`,
    { signal, cache: "no-store" },
  );
export const createCampaignPreference = (
  contactId: string,
  payload: {
    target: "phone" | "identity";
    evidenceConversationId?: string;
    shoppingId: string | null;
    reason: string;
  },
) =>
  apiRequest<CampaignPreference>(
    `/contacts/${contactId}/campaign-preferences`,
    { method: "POST", body: JSON.stringify(payload) },
  );
export const revokeCampaignPreference = (
  id: string,
  payload: { version: number; reason: string; confirmed: boolean },
) =>
  apiRequest<CampaignPreference>(
    `/contacts/campaign-preferences/${id}/revoke`,
    { method: "POST", body: JSON.stringify(payload) },
  );
export const getCampaignPreferenceEvents = (id: string, page = 1) =>
  apiRequest<{
    items: PreferenceEvent[];
    total: number;
    page: number;
    pageSize: number;
  }>(`/contacts/campaign-preferences/${id}/events?page=${page}&pageSize=10`, {
    cache: "no-store",
  });
