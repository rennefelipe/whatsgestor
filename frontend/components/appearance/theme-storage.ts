export const themes = [
  {
    id: "white",
    label: "Branco",
    description: "Superfícies brancas e cores vivas.",
  },
  {
    id: "gray",
    label: "Cinza",
    description: "Cinzas equilibrados com alto contraste.",
  },
  {
    id: "dark",
    label: "Escuro",
    description: "Grafite, azul profundo e textos claros.",
  },
] as const;
export type Theme = (typeof themes)[number]["id"];
export const PUBLIC_THEME_ID = "$guest";
export const THEME_STORAGE_PREFIX = "whatsgestor.appearance.";
const CHANGE_EVENT = "whatsgestor:appearance-changed";
const temporaryPreferences = new Map<string, Theme>();

export function isTheme(value: unknown): value is Theme {
  return value === "white" || value === "gray" || value === "dark";
}
export function themeKey(userId: string): string {
  return THEME_STORAGE_PREFIX + userId.toLowerCase();
}
export function readTheme(userId: string | null): Theme {
  if (typeof window === "undefined") return "white";
  const key = themeKey(userId ?? PUBLIC_THEME_ID);
  const temporary = temporaryPreferences.get(key);
  if (temporary) return temporary;
  try {
    const stored = window.localStorage.getItem(key);
    return isTheme(stored) ? stored : "white";
  } catch {
    return "white";
  }
}
export function writeTheme(userId: string, theme: Theme): boolean {
  const key = themeKey(userId);
  let persisted = true;
  try {
    window.localStorage.setItem(key, theme);
    temporaryPreferences.delete(key);
  } catch {
    temporaryPreferences.set(key, theme);
    persisted = false;
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
  return persisted;
}
export function subscribeToTheme(callback: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(CHANGE_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

// This only selects appearance before paint. /auth/me remains the authority for identity and permissions.
function initializeTheme(prefix: string) {
  let theme = "white";
  try {
    const publicTheme = window.localStorage.getItem(prefix + "$guest");
    if (
      publicTheme === "white" ||
      publicTheme === "gray" ||
      publicTheme === "dark"
    )
      theme = publicTheme;
    const token = window.sessionStorage.getItem("whatsgestor.accessToken");
    const body = token?.split(".")[1];
    if (body) {
      const payload: unknown = JSON.parse(
        window.atob(body.replace(/-/g, "+").replace(/_/g, "/")),
      );
      if (
        typeof payload === "object" &&
        payload !== null &&
        "sub" in payload &&
        typeof payload.sub === "string"
      ) {
        const stored = window.localStorage.getItem(
          prefix + payload.sub.toLowerCase(),
        );
        theme =
          stored === "white" || stored === "gray" || stored === "dark"
            ? stored
            : "white";
      }
    }
  } catch {
    /* Storage disabled or invalid session hint: use the public default. */
  }
  document.documentElement.dataset.theme = theme;
}
export const THEME_BOOTSTRAP_SCRIPT =
  "(" +
  initializeTheme.toString() +
  ")(" +
  JSON.stringify(THEME_STORAGE_PREFIX) +
  ")";
