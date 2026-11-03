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
    { method: "POST", body: JSON.stringify({ allowPairing: true }) },
  );
}

export function getWhatsappConnectionQr(
  id: string,
): Promise<WhatsappConnectionQrResponse> {
  return apiRequest<{
    qrCodeDataUrl: string | null;
    expiresAt: string | null;
  }>(
    `/whatsapp-connections/${encodeURIComponent(id)}/qr`,
  ).then((response) => ({
    qrCode: response.qrCodeDataUrl ?? "",
    expiresAt: response.expiresAt ?? "",
  }));
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

export function recoverWhatsappPairing(id: string): Promise<WhatsappConnectionStatusResponse> {
  return apiRequest<WhatsappConnectionStatusResponse>(
    `/whatsapp-connections/${encodeURIComponent(id)}/pairing-recovery`,
    { method: "POST", body: JSON.stringify({ confirmation: id, acknowledgeCredentialReplacement: true }) },
  );
}

export function retryWhatsappStorage(id: string): Promise<WhatsappConnectionStatusResponse> {
  return apiRequest<WhatsappConnectionStatusResponse>(
    `/whatsapp-connections/${encodeURIComponent(id)}/storage-retry`,
    { method: "POST" },
  );
}
