export type Section =
  | "data-exchange"
  | "organizations"
  | "organization-types"
  | "contact-types"
  | "contact-identification"
  | "appearance"
  | "automatic-messages"
  | "users"
  | "contacts"
  | "settings"
  | "whatsapp-connections"
  | "whatsapp-monitor"
  | "conversations"
  | "bulk-send";

const sections = new Set<Section>([
  "data-exchange", "organizations", "organization-types", "contact-types", "contact-identification", "appearance", "automatic-messages",
  "users",
  "contacts",
  "settings",
  "whatsapp-connections",
  "whatsapp-monitor",
  "conversations",
  "bulk-send",
]);
const eventName = "whatsgestor.section.changed";

export function readSection(): Section {
  if (typeof window === "undefined") return "conversations";
  const section = window.location.hash.slice(1) as Section;
  return sections.has(section) ? section : "conversations";
}

export function writeSection(section: Section) {
  if (!sections.has(section) || readSection() === section) return;
  window.history.pushState(null, "", `#${section}`);
  window.dispatchEvent(new Event(eventName));
}

export function subscribeSection(listener: () => void) {
  window.addEventListener("hashchange", listener);
  window.addEventListener("popstate", listener);
  window.addEventListener(eventName, listener);
  return () => {
    window.removeEventListener("hashchange", listener);
    window.removeEventListener("popstate", listener);
    window.removeEventListener(eventName, listener);
  };
}
