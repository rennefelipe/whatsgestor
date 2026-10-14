import { apiRequest } from "./client";
import type {
  Contact,
  ContactDisplaySetting,
  ContactPayload,
  ContactType,
  Organization,
} from "@/types/api";

export interface ContactFilters {
  organizationId: string;
  contactTypeId: string;
  isActive: string;
  search: string;
}

export function getContacts(
  filters: ContactFilters,
  signal?: AbortSignal,
): Promise<Contact[]> {
  const params = new URLSearchParams();
  if (filters.organizationId) params.set("organizationId", filters.organizationId);
  if (filters.contactTypeId) params.set("contactTypeId", filters.contactTypeId);
  if (filters.isActive) params.set("isActive", filters.isActive);
  if (filters.search.trim()) params.set("search", filters.search.trim());
  const query = params.toString();
  return apiRequest<Contact[]>(`/contacts${query ? `?${query}` : ""}`, { signal });
}

export function getOrganizations(signal?: AbortSignal): Promise<Organization[]> {
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
  payload: ContactPayload,
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
  return apiRequest<Contact>(
    `/contacts/${encodeURIComponent(id)}/active`,
    {
      method: "PATCH",
      body: JSON.stringify({ isActive }),
    },
  );
}
