import type { FileMetadata } from '../messages/file-policy';
import type { MessageRecordInput } from '../whatsapp-conversations/message-record.port';
import { canonicalMime } from '../messages/file-policy';
import { codedError } from './contracts';

export function normalizeJid(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 255) return null;
  const match = /^([0-9]+)(?::[0-9]+)?@(s\.whatsapp\.net|lid|hosted|hosted\.lid)$/.exec(value);
  if (match) return match[1] + '@' + match[2];
  return /^[0-9]+(?:-[0-9]+)?@g\.us$/.test(value) ? value : null;
}
export function messageTime(value: unknown): Date | null {
  try {
    const long=value as {low?:number;high?:number;toNumber?:()=>number}|null;
    const number = typeof long?.toNumber === 'function' ? long.toNumber() : typeof long?.low==='number'&&typeof long.high==='number' ? long.high*4294967296+(long.low>>>0) : Number(value);
    if (value == null || !Number.isFinite(number) || number <= 0 || number * 1000 > 8640000000000000) return null;
    return new Date(number * 1000);
  } catch { return null; }
}
export interface NormalizedMessage {
  record: MessageRecordInput;
  metadata?: FileMetadata;
  sender: string | null;
  alternate: string | null;
  senderAlternate: string | null;
  classification: 'recent' | 'history' | 'unknown_time';
  unsupported: boolean;
}
export function normalizeProviderMessage(connectionId: string, raw: any, type: string, epochAt: number, requestedHistory: boolean): NormalizedMessage | null {
  const jid = normalizeJid(raw?.key?.remoteJid);
  const id = raw?.key?.id;
  if (!jid || typeof id !== 'string' || !id.trim() || id.length > 255 || typeof raw.key.fromMe !== 'boolean') return null;
  const timestamp = messageTime(raw.messageTimestamp);
  const classification = !timestamp || timestamp.getTime()>Date.now()+300000 ? 'unknown_time' : type !== 'notify' || requestedHistory || timestamp.getTime() < epochAt - 5000 ? 'history' : 'recent';
  let content = raw.message;
  for (let n = 0; n < 5 && content; n++) {
    const wrapped = content.ephemeralMessage ?? content.viewOnceMessage ?? content.viewOnceMessageV2 ?? content.documentWithCaptionMessage;
    if (!wrapped) break;
    content = wrapped.message;
  }
  const mediaKeys = [['imageMessage','image'],['audioMessage','audio'],['videoMessage','video'],['documentMessage','document']] as const;
  let metadata: FileMetadata | undefined;
  let text: string | null = typeof content?.conversation === 'string' ? content.conversation : typeof content?.extendedTextMessage?.text === 'string' ? content.extendedTextMessage.text : null;
  for (const [key, kind] of mediaKeys) {
    const file = content?.[key];
    if (!file) continue;
    const defaults = { image: ['image/jpeg','imagem.jpg'], audio: ['audio/ogg','audio.ogg'], video: ['video/mp4','video.mp4'], document: ['application/octet-stream',null] };
    const mime = typeof file.mimetype === 'string' ? file.mimetype : defaults[kind][0]!;
    const base = canonicalMime(mime);
    const extension = base === 'image/png' ? '.png' : base === 'image/webp' ? '.webp' : base === 'image/gif' ? '.gif' :
      base === 'audio/mpeg' ? '.mp3' : base === 'audio/mp4' ? '.m4a' : base === 'audio/wav' ? '.wav' : base === 'audio/aac' ? '.aac' : base === 'video/webm' ? '.webm' : null;
    const fallback = extension && kind !== 'document' ? kind + extension : defaults[kind][1];
    metadata = { kind, mimeType: mime, originalName: typeof file.fileName === 'string' ? file.fileName : fallback,
      ...(Number.isSafeInteger(file.seconds) && file.seconds >= 0 ? { durationSeconds: file.seconds } : {}),
      ...(Number.isSafeInteger(file.width) && file.width > 0 ? { width: file.width } : {}),
      ...(Number.isSafeInteger(file.height) && file.height > 0 ? { height: file.height } : {}) };
    text = typeof file.caption === 'string' ? file.caption : null;
    break;
  }
  const unsupported = !metadata && (typeof text !== 'string' || !text.trim());
  const fromMe = raw.key.fromMe;
  const record: MessageRecordInput = { connectionId, remoteJid: jid, whatsappMessageId: id, fromMe,
    origin: classification !== 'recent' ? 'history' : fromMe ? 'outgoing' : 'live',
    messageType: metadata?.kind ?? (unsupported ? 'unsupported' : 'text'), textContent: text,
    messageTimestamp: timestamp, status: fromMe ? 'sent' : 'received',
    ...(!jid.endsWith('@g.us') && typeof raw.pushName === 'string' ? { contactName: raw.pushName.slice(0,255) } : {}) };
  return { record, metadata, classification, unsupported,
    sender: jid.endsWith('@g.us') ? normalizeJid(raw.key.participant) : jid,
    senderAlternate:jid.endsWith('@g.us')?normalizeJid(raw.key.participantAlt):normalizeJid(raw.key.remoteJidAlt),
    alternate: normalizeJid(raw.key.remoteJidAlt) };
}

export async function collectMedia(source: AsyncIterable<Uint8Array>, limit: number, signal: AbortSignal): Promise<Buffer> {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of source) {
    signal.throwIfAborted();
    size += chunk.byteLength;
    if (size > limit) throw codedError('MEDIA_SIZE_LIMIT', 413);
    chunks.push(Buffer.from(chunk));
  }
  signal.throwIfAborted();
  return Buffer.concat(chunks, size);
}
