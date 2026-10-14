import type {
  WhatsappConnection,
  WhatsappConnectionQrResponse,
  WhatsappConnectionStatusResponse,
} from "@/types/api";
import { apiRequest } from "./client";

export interface WhatsappConnectionPayload {
  name: string;
  isActive?: boolean;
}

export function getWhatsappConnections(
  signal?: AbortSignal,
): Promise<WhatsappConnection[]> {
  return apiRequest<WhatsappConnection[]>("/whatsapp-connections", { signal });
}

export function createWhatsappConnection(
  payload: WhatsappConnectionPayload,
): Promise<WhatsappConnection> {
  return apiRequest<WhatsappConnection>("/whatsapp-connections", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateWhatsappConnection(
  id: string,
  payload: WhatsappConnectionPayload,
): Promise<WhatsappConnection> {
  return apiRequest<WhatsappConnection>(
    `/whatsapp-connections/${encodeURIComponent(id)}`,
    { method: "PATCH", body: JSON.stringify(payload) },
  );
}

export function updateWhatsappConnectionActive(
  id: string,
  isActive: boolean,
): Promise<WhatsappConnection> {
  return apiRequest<WhatsappConnection>(
    `/whatsapp-connections/${encodeURIComponent(id)}/active`,
    { method: "PATCH", body: JSON.stringify({ isActive }) },
  );
}

export function connectWhatsappConnection(
  id: string,
): Promise<WhatsappConnectionStatusResponse> {
  return apiRequest<WhatsappConnectionStatusResponse>(
    `/whatsapp-connections/${encodeURIComponent(id)}/connect`,
    { method: "POST" },
  );
}

export function getWhatsappConnectionQr(
  id: string,
): Promise<WhatsappConnectionQrResponse> {
  return apiRequest<WhatsappConnectionQrResponse>(
    `/whatsapp-connections/${encodeURIComponent(id)}/qr`,
  );
}

export function getWhatsappConnectionStatus(
  id: string,
): Promise<WhatsappConnectionStatusResponse> {
  return apiRequest<WhatsappConnectionStatusResponse>(
    `/whatsapp-connections/${encodeURIComponent(id)}/status`,
  );
}

export function disconnectWhatsappConnection(
  id: string,
): Promise<WhatsappConnectionStatusResponse> {
  return apiRequest<WhatsappConnectionStatusResponse>(
    `/whatsapp-connections/${encodeURIComponent(id)}/disconnect`,
    { method: "POST" },
  );
}

export function logoutWhatsappConnection(
  id: string,
): Promise<WhatsappConnectionStatusResponse> {
  return apiRequest<WhatsappConnectionStatusResponse>(
    `/whatsapp-connections/${encodeURIComponent(id)}/logout`,
    { method: "POST" },
  );
}
