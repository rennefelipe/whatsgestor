const PREFIX = "whatsgestor.sidebar.";
const EVENT = "whatsgestor:sidebar-changed";
const temporary = new Map<string, boolean>();
export function readSidebar(userId: string | undefined): boolean {
  if (!userId || typeof window === "undefined") return false;
  const key = PREFIX + userId.toLowerCase();
  if (temporary.has(key)) return temporary.get(key)!;
  try {
    return window.localStorage.getItem(key) === "collapsed";
  } catch {
    return false;
  }
}
export function writeSidebar(userId: string, collapsed: boolean): void {
  const key = PREFIX + userId.toLowerCase();
  try {
    window.localStorage.setItem(key, collapsed ? "collapsed" : "expanded");
    temporary.delete(key);
  } catch {
    temporary.set(key, collapsed);
  }
  window.dispatchEvent(new Event(EVENT));
}
export function subscribeSidebar(callback: () => void) {
  window.addEventListener(EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}
