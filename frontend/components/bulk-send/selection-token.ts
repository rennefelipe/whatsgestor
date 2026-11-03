const temporaryTokens = new Map<string, string>();
const valid = (value: string | null | undefined): value is string =>
  !!value && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value);
export function readSelectionToken(owner: string): string | null {
  let stored: string | null = null;
  try {
    stored = sessionStorage.getItem(`whatsgestor.recipient-selection.${owner}`);
  } catch {
    /* Use memory if storage is blocked. */
  }
  const token = valid(stored) ? stored : temporaryTokens.get(owner);
  return valid(token) ? token : null;
}
export function writeSelectionToken(owner: string, token: string) {
  if (!valid(token)) return;
  temporaryTokens.set(owner, token);
  try {
    sessionStorage.setItem(`whatsgestor.recipient-selection.${owner}`, token);
  } catch {
    /* Only the opaque ID is retained in memory. */
  }
}
