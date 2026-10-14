import { apiRequest } from "./client";
import type {
  ContactDisplaySetting,
  ContactType,
  Organization,
  OrganizationType,
} from "@/types/api";

export interface NamedEntityPayload {
  name: string;
  isActive: boolean;
}

export interface OrganizationPayload extends NamedEntityPayload {
  organizationTypeId: string;
  parentOrganizationId: string | null;
}

export interface ContactDisplaySettingPayload {
  isVisible: boolean;
  displayOrder: number;
}

export function getOrganizationTypes(
  signal?: AbortSignal,
): Promise<OrganizationType[]> {
  return apiRequest<OrganizationType[]>("/organization-types", { signal });
}

export function createOrganizationType(
  payload: NamedEntityPayload,
): Promise<OrganizationType> {
  return apiRequest<OrganizationType>("/organization-types", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateOrganizationType(
  id: string,
  payload: NamedEntityPayload,
): Promise<OrganizationType> {
  return apiRequest<OrganizationType>(
    `/organization-types/${encodeURIComponent(id)}`,
    { method: "PATCH", body: JSON.stringify(payload) },
  );
}

export function updateOrganizationTypeActive(
  id: string,
  isActive: boolean,
): Promise<OrganizationType> {
  return apiRequest<OrganizationType>(
    `/organization-types/${encodeURIComponent(id)}/active`,
    { method: "PATCH", body: JSON.stringify({ isActive }) },
  );
}

export function getSettingsOrganizations(
  signal?: AbortSignal,
): Promise<Organization[]> {
  return apiRequest<Organization[]>("/organizations", { signal });
}

export function createOrganization(
  payload: OrganizationPayload,
): Promise<Organization> {
  return apiRequest<Organization>("/organizations", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateOrganization(
  id: string,
  payload: OrganizationPayload,
): Promise<Organization> {
  return apiRequest<Organization>(`/organizations/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function updateOrganizationActive(
  id: string,
  isActive: boolean,
): Promise<Organization> {
  return apiRequest<Organization>(
    `/organizations/${encodeURIComponent(id)}/active`,
    { method: "PATCH", body: JSON.stringify({ isActive }) },
  );
}

export function getSettingsContactTypes(
  signal?: AbortSignal,
): Promise<ContactType[]> {
  return apiRequest<ContactType[]>("/contact-types", { signal });
}

export function createContactType(
  payload: NamedEntityPayload,
): Promise<ContactType> {
  return apiRequest<ContactType>("/contact-types", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateContactType(
  id: string,
  payload: NamedEntityPayload,
): Promise<ContactType> {
  return apiRequest<ContactType>(`/contact-types/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function updateContactTypeActive(
  id: string,
  isActive: boolean,
): Promise<ContactType> {
  return apiRequest<ContactType>(
    `/contact-types/${encodeURIComponent(id)}/active`,
    { method: "PATCH", body: JSON.stringify({ isActive }) },
  );
}

export function updateContactDisplaySetting(
  id: string,
  payload: ContactDisplaySettingPayload,
): Promise<ContactDisplaySetting> {
  return apiRequest<ContactDisplaySetting>(
    `/contact-display-settings/${encodeURIComponent(id)}`,
    { method: "PATCH", body: JSON.stringify(payload) },
  );
}
