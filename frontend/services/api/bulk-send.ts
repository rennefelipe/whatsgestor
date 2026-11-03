import { apiRequest } from "./client";

export interface RecipientFilters {
  groupId?: string;
  shoppingId?: string;
  storeName?: string;
  withoutStore?: boolean;
  contactTypeId?: string;
  contactName?: string;
  phone?: string;
}
export interface Recipient {
  sourceCount: number;
  sourcePreviewTruncated: boolean;
  key: string;
  contactIds: string[];
  names: string[];
  originalPhones: string[];
  normalizedPhone: string | null;
  group: string | null;
  shopping: string | null;
  organization: string | null;
  storeName: string | null;
  role: string | null;
  eligible: boolean;
  selected: boolean;
  reasons: string[];
  warnings: string[];
  platformStatus: "not_verified";
}
export interface RecipientSelection {
  persistence: "sql";
  revisionId: string | null;
  hasPublishedRevision: boolean;
  operation: SelectionOperation | null;
  id: string;
  version: number;
  expiresAt: string | null;
  filters: RecipientFilters;
  items: Recipient[];
  total: number;
  page: number;
  pageSize: number;
  view: "query" | "selected";
  preferencesStatus: "available" | "not_configured";
  readyForSending: false;
  summary: {
    recordsFound: number;
    recipientsFound: number;
    eligibleFound: number;
    selectedRecipients: number;
    selectedEligible: number;
    uniqueNumbers: number;
    duplicatesIdentified: number;
    blockedRecipients: number;
    blockedSelected: number;
    repeatedSelectedNumbers: number;
  };
}
const base = "/bulk-send/recipient-selections";
export interface SelectionOperation {
  id: string;
  requestId: string;
  selectionId: string;
  status: "building" | "completed" | "failed";
  processed: number;
  total: number;
  attempt: number;
  recoverable: boolean;
  leaseExpiresAt: string;
  errors: { at: string; message: string }[];
}
function requestId() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
async function mutate(
  path: string,
  method: string,
  body: object,
  signal?: AbortSignal,
  onProgress?: (operation: SelectionOperation | null) => void,
): Promise<RecipientSelection> {
  const id = requestId();
  let finished = false;
  const poll = async () => {
    try {
      const operation = onProgress ? await getSelectionOperation(id) : null;
      if (!finished) onProgress?.(operation);
    } catch {
      /* Main request reports errors, including pending migrations. */
    }
  };
  const timer = onProgress ? setInterval(() => void poll(), 1000) : null;
  try {
    const result = await apiRequest<RecipientSelection>(path, {
      method,
      body: JSON.stringify({ ...body, requestId: id }),
      signal,
    });
    finished = true;
    onProgress?.(result.operation);
    return result;
  } catch (error) {
    await poll();
    throw error;
  } finally {
    finished = true;
    if (timer) clearInterval(timer);
  }
}
export const getLatestRecipientSelection = (signal?: AbortSignal) =>
  apiRequest<RecipientSelection | null>(`${base}/latest`, {
    signal,
    cache: "no-store",
  });
export const getSelectionOperation = (id: string) =>
  apiRequest<SelectionOperation>(
    `${base}/operations/${encodeURIComponent(id)}`,
    { cache: "no-store" },
  );
export const recoverSelectionOperation = (id: string) =>
  apiRequest<RecipientSelection>(
    `${base}/operations/${encodeURIComponent(id)}/recover`,
    { method: "POST" },
  );
export function createRecipientSelection(
  filters: RecipientFilters,
  signal?: AbortSignal,
  onProgress?: (operation: SelectionOperation | null) => void,
): Promise<RecipientSelection> {
  return mutate(base, "POST", { filters }, signal, onProgress);
}
export function getRecipientSelection(
  id: string,
  page = 1,
  view: "query" | "selected" = "query",
  signal?: AbortSignal,
): Promise<RecipientSelection> {
  return apiRequest(
    `${base}/${encodeURIComponent(id)}?page=${page}&pageSize=25&view=${view}`,
    { signal },
  );
}
export function updateRecipientSelection(
  selection: RecipientSelection,
  action: "filter" | "add" | "remove" | "all" | "clear" | "review",
  extra: { filters?: RecipientFilters; key?: string } = {},
  onProgress?: (operation: SelectionOperation | null) => void,
): Promise<RecipientSelection> {
  return mutate(
    `${base}/${encodeURIComponent(selection.id)}`,
    "PATCH",
    { action, version: selection.version, ...extra },
    undefined,
    onProgress,
  );
}
