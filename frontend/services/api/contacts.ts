import { apiRequest } from "./client";
import type {
  Contact,
  ContactDisplaySetting,
  ContactPayload,
  ContactType,
  Organization,
  ContactOptions,
  PaginatedResponse,
} from "@/types/api";

export interface ContactFilters {
  groupId?: string;
  shoppingId?: string;
  storeName?: string;
  withoutStore?: string;
  contactName?: string;
  phone?: string;
  organizationId: string;
  contactTypeId: string;
  isActive: string;
  search: string;
}

function contactParams(filters: ContactFilters) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value?.trim()) params.set(key, value.trim());
  }
  return params;
}

export function getContactOptions(
  signal?: AbortSignal,
): Promise<ContactOptions> {
  return apiRequest<ContactOptions>("/contacts/options", { signal });
}

export function getContactsPage(
  filters: ContactFilters,
  page: number,
  signal?: AbortSignal,
): Promise<PaginatedResponse<Contact>> {
  const params = contactParams(filters);
  params.set("page", String(page));
  params.set("pageSize", "25");
  return apiRequest(`/contacts?${params}`, { signal });
}

export function getContacts(
  filters: ContactFilters,
  signal?: AbortSignal,
): Promise<Contact[]> {
  const params = contactParams(filters);
  const query = params.toString();
  return apiRequest<Contact[]>(`/contacts${query ? `?${query}` : ""}`, {
    signal,
  });
}

export function getOrganizations(
  signal?: AbortSignal,
): Promise<Organization[]> {
  return apiRequest<Organization[]>("/organizations", { signal });
}

export function getContactTypes(signal?: AbortSignal): Promise<ContactType[]> {
  return apiRequest<ContactType[]>("/contact-types", { signal });
}

export function getContactDisplaySettings(
  signal?: AbortSignal,
): Promise<ContactDisplaySetting[]> {
  return apiRequest<ContactDisplaySetting[]>("/contact-display-settings", {
    signal,
  });
}

export function createContact(payload: ContactPayload): Promise<Contact> {
  return apiRequest<Contact>("/contacts", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateContact(
  id: string,
  payload: Partial<ContactPayload>,
): Promise<Contact> {
  return apiRequest<Contact>(`/contacts/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function updateContactActive(
  id: string,
  isActive: boolean,
): Promise<Contact> {
  return apiRequest<Contact>(`/contacts/${encodeURIComponent(id)}/active`, {
    method: "PATCH",
    body: JSON.stringify({ isActive }),
  });
}
