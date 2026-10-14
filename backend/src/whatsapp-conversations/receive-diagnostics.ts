import { appendFileSync, mkdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import type { WAMessage } from '@whiskeysockets/baileys';

// Opt-in, expiring, bounded diagnostics. Never pass payloads or error messages here.
export function receiveDiagnostic(
  event: string,
  details: Record<string, string | number | boolean | null> = {},
): void {
  const until = Date.parse(
    process.env.WHATSAPP_RECEIVE_DIAGNOSTICS_UNTIL ?? '',
  );
  if (!Number.isFinite(until) || Date.now() >= until) return;
  try {
    const directory = resolve(__dirname, '../../logs');
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const file = resolve(directory, 'whatsapp-receive-diagnostics.log');
    try {
      if (statSync(file).size >= 2 * 1024 * 1024) return;
    } catch {
      // File is created only when diagnostics are enabled.
    }
    appendFileSync(
      file,
      JSON.stringify({
        at: new Date().toISOString(),
        pid: process.pid,
        event,
        ...details,
      }) + '\n',
      { mode: 0o600 },
    );
  } catch {
    // Diagnostics must never interrupt reception.
  }
}

export function receivedMessageCategory(message: WAMessage): string {
  let content = message.message;
  for (let i = 0; i < 3; i++) {
    const inner =
      content?.ephemeralMessage?.message ??
      content?.documentWithCaptionMessage?.message;
    if (!inner) break;
    content = inner;
  }
  if (
    content?.viewOnceMessage ||
    content?.viewOnceMessageV2 ||
    content?.viewOnceMessageV2Extension
  )
    return 'view_once';
  if (content?.imageMessage) return 'image';
  if (content?.audioMessage) return 'audio';
  if (content?.documentMessage) return 'document';
  if (content?.conversation || content?.extendedTextMessage) return 'text';
  if (content?.protocolMessage) return 'protocol';
  return content ? 'unsupported' : 'empty';
}

export function receivedJidCategory(jid: string | null | undefined): string {
  if (!jid) return 'missing';
  if (/^[^@\s]+@s\.whatsapp\.net$/.test(jid)) return 'individual_pn';
  if (/^[^@\s]+@lid$/.test(jid)) return 'individual_lid';
  if (jid.endsWith('@g.us')) return 'group';
  if (jid.endsWith('@broadcast')) return 'broadcast';
  if (jid.endsWith('@newsletter')) return 'newsletter';
  return 'other';
}

export function receiveFailureCategory(error: unknown): string {
  if (!(error instanceof Error)) return 'unknown';
  if (error.message.startsWith('WebSocket Error (')) return 'websocket';
  if (error.message === 'Connection Failure') return 'server_rejection';
  if (error.message.startsWith('Stream Errored (')) return 'stream';
  return 'other';
}
