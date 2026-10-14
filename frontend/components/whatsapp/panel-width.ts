const PREFIX = "whatsgestor.panel-width.";
const EVENT = "whatsgestor:panel-width";
const temporary = new Map<string, number | null>();
export function panelLimits(container: number) {
  const max = Math.max(240, Math.min(480, container - 328));
  return { min: 240, max };
}
export function panelWidth(container: number, preference: number | null) {
  const { min, max } = panelLimits(container);
  const desired = preference ?? Math.max(285, Math.min(330, container * 0.28));
  return Math.round(Math.max(min, Math.min(max, desired)));
}
export function readPanelWidth(userId?: string): number | null {
  if (!userId || typeof window === "undefined") return null;
  const key = PREFIX + userId.toLowerCase();
  if (temporary.has(key)) return temporary.get(key)!;
  try {
    const raw = window.localStorage.getItem(key);
    const value = raw === null ? NaN : Number(raw);
    return Number.isFinite(value) && value >= 240 && value <= 480
      ? value
      : null;
  } catch {
    return null;
  }
}
export function writePanelWidth(userId: string, value: number | null) {
  const key = PREFIX + userId.toLowerCase();
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, String(value));
    temporary.delete(key);
  } catch {
    temporary.set(key, value);
  }
  window.dispatchEvent(new Event(EVENT));
}
export function subscribePanelWidth(callback: () => void) {
  window.addEventListener(EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}
