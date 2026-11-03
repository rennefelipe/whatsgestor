import { apiRequest } from "./client";

export type ReceiveStage = "R0" | "R1" | "R2" | "R3" | "R4" | "R5" | "R6";
export type SafeMonitorError = Record<string, string | number | boolean | null>;
export interface ReceiveTrace {
  messageRef: string;
  firstObservedAt: string;
  lastObservedAt: string;
  messageTimestamp: string | null;
  timestampRelation: string;
  type: "notify" | "append" | null;
  category: string;
  direction: string;
  stages: Partial<Record<ReceiveStage, string>>;
  sqlStartedAt: string | null;
  upsertRequestedAt: string | null;
  bufferedWhenRequested: boolean | null;
  outcome: "pending" | "persisted" | "filtered" | "failed";
  filterReason: string | null;
  error: SafeMonitorError | null;
  lastConfirmedStage: ReceiveStage | null;
  nextStageNotObserved: ReceiveStage | null;
  cause: string;
}
export interface ReceiveMonitorConnection {
  connectionRef: string;
  generation: number;
  since: string;
  websocketOpen: boolean | null;
  authentication: string;
  syncState: string | null;
  buffering: boolean | null;
  receivedPendingNotifications: boolean | null;
  offlineTerminalAt: string | null;
  offlinePreviewCount: number | null;
  snapshotAt: string | null;
  rawFrameCount: number;
  decodedFrameCount: number;
  lastRawAt: string | null;
  lastDecodedAt: string | null;
  lastTransportMessageAt: string | null;
  lastError: SafeMonitorError | null;
  queue: Record<string, string | number | boolean | null> | null;
  counters: Record<ReceiveStage, number>;
  filtered: number;
  failed: number;
  evictedMessages: number;
  messages: ReceiveTrace[];
  lastNewMessage: ReceiveTrace | null;
  initialSyncComplete: boolean;
  cause: string;
}
export interface ReceiveMonitor {
  schemaVersion: number;
  bootId: string;
  startedAt: string;
  at: string;
  instrumentation: { active: boolean; modules: string[]; failure: string | null; expectedModules: string[] };
  retention: { minutes: number; maxMessagesPerConnection: number; maxConnections: number };
  stages: Array<{ id: ReceiveStage; label: string }>;
  connections: ReceiveMonitorConnection[];
}
export function getWhatsappMonitor(signal: AbortSignal) {
  return apiRequest<ReceiveMonitor>("/whatsapp-connections/monitor", { signal, cache: "no-store" });
}
