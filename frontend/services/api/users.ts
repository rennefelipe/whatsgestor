import type {
  AuthenticatedUser,
  CreateUserPayload,
  UpdateUserPayload,
} from "@/types/api";
import { apiRequest } from "./client";

export function getUsers(signal?: AbortSignal): Promise<AuthenticatedUser[]> {
  return apiRequest<AuthenticatedUser[]>("/users", { signal });
}

export function getUsersSchema(signal?: AbortSignal): Promise<{ profileFieldsAvailable: boolean }> {
  return apiRequest("/users/schema", { signal });
}

export function createUser(
  payload: CreateUserPayload,
): Promise<AuthenticatedUser> {
  return apiRequest<AuthenticatedUser>("/users", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateUser(
  id: string,
  payload: UpdateUserPayload,
): Promise<AuthenticatedUser> {
  return apiRequest<AuthenticatedUser>(`/users/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function updateUserActive(
  id: string,
  isActive: boolean,
): Promise<AuthenticatedUser> {
  return apiRequest<AuthenticatedUser>(
    `/users/${encodeURIComponent(id)}/active`,
    { method: "PATCH", body: JSON.stringify({ isActive }) },
  );
}

export function updateUserDeletePermission(
  id: string,
  canDelete: boolean,
): Promise<AuthenticatedUser> {
  return apiRequest<AuthenticatedUser>(
    `/users/${encodeURIComponent(id)}/delete-permission`,
    { method: "PATCH", body: JSON.stringify({ canDelete }) },
  );
}
