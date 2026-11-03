import type { ApiErrorPayload } from "@/types/api";
import { getAccessToken, notifyAuthenticationExpired } from "./auth-session";

const apiBaseUrl = (
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"
).replace(/\/+$/, "");

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly dispatchAttempted?: boolean,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

function getErrorMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object") {
    const body = payload as ApiErrorPayload;
    if (Array.isArray(body.message)) return body.message.join(" ");
    if (typeof body.message === "string") return body.message;
    if (typeof body.error === "string") return body.error;
  }
  return fallback;
}

function responseErrorMessage(status: number, path: string): string {
  if (status === 401)
    return path === "/auth/login"
      ? "Usuário ou senha inválidos."
      : "Sessão expirada ou inválida. Entre novamente.";
  if (status === 403)
    return "Você não tem permissão para realizar esta operação.";
  if ([502, 503, 504].includes(status))
    return "A API está temporariamente indisponível. Tente novamente em instantes.";
  return "Não foi possível concluir a solicitação.";
}

export async function apiRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  let response: Response;
  try {
    const isLoginRequest = path === "/auth/login";
    const token = isLoginRequest ? null : getAccessToken();
    response = await fetch(`${apiBaseUrl}${path}`, {
      ...init,
      headers: {
        ...(init.body &&
        !(typeof FormData !== "undefined" && init.body instanceof FormData)
          ? { "Content-Type": "application/json" }
          : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init.headers,
      },
    });
  } catch {
    throw new ApiRequestError(
      "Não foi possível conectar à API. Verifique se o backend está em execução.",
      0,
    );
  }

  if (response.status === 401 && path !== "/auth/login") {
    notifyAuthenticationExpired();
  }

  const text = await response.text();
  let payload: unknown;
  if (text) {
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      throw new ApiRequestError(
        response.ok
          ? "A API retornou uma resposta inválida."
          : responseErrorMessage(response.status, path),
        response.status,
      );
    }
  }

  if (!response.ok) {
    throw new ApiRequestError(
      getErrorMessage(payload, responseErrorMessage(response.status, path)),
      response.status,
      typeof (payload as ApiErrorPayload)?.code==='string'?(payload as ApiErrorPayload).code:undefined,
      typeof (payload as ApiErrorPayload)?.dispatchAttempted==='boolean'?(payload as ApiErrorPayload).dispatchAttempted:undefined,
    );
  }

  return payload as T;
}

// Binary requests share the same session and expiration handling as JSON requests.
export async function apiBlob(
  path: string,
  signal?: AbortSignal,
): Promise<Blob> {
  const token = getAccessToken();
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}${path}`, {
      signal,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      cache: "no-store",
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ApiRequestError("Não foi possível carregar a mídia.", 0);
  }
  if (response.status === 401) notifyAuthenticationExpired();
  if (!response.ok)
    throw new ApiRequestError(
      response.status === 401
        ? "Sessão expirada."
        : "Não foi possível carregar esta mídia.",
      response.status,
    );
  return response.blob();
}
