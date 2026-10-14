const TOKEN_STORAGE_KEY = "whatsgestor.accessToken";
export const AUTH_EXPIRED_EVENT = "whatsgestor:auth-expired";

export function getAccessToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.sessionStorage.getItem(TOKEN_STORAGE_KEY);
}

export function saveAccessToken(token: string): void {
  window.sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
}

export function clearAccessToken(): void {
  if (typeof window !== "undefined") {
    window.sessionStorage.removeItem(TOKEN_STORAGE_KEY);
  }
}

export function notifyAuthenticationExpired(): void {
  clearAccessToken();
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
  }
}
