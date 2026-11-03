import { createDecipheriv, createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { codedError } from './contracts';
import { FilePolicy } from '../messages/file-policy';
import { normalizeProviderMessage } from './normalize-message';

export interface MediaKeys { iv: Uint8Array; cipherKey: Uint8Array; macKey: Uint8Array }
export type MediaKeyResolver = (key: Uint8Array, kind: string) => Promise<MediaKeys>;
export type MediaFetch = (url: string, options: RequestInit) => Promise<Response>;
function bytes(value: unknown, length: number): Buffer {
  const result = typeof value === 'string' ? Buffer.from(value, 'base64') : value instanceof Uint8Array ? Buffer.from(value) : null;
  if (!result || result.length !== length) throw codedError('MEDIA_INTEGRITY_METADATA_INVALID', 422);
  return result;
}
function contentOf(message: any): any {
  let content = message?.message;
  for (let n = 0; n < 5 && content; n++) {
    const wrapped = content.ephemeralMessage ?? content.viewOnceMessage ?? content.viewOnceMessageV2 ?? content.documentWithCaptionMessage;
    if (!wrapped) break;
    content = wrapped.message;
  }
  return content;
}
function mediaUrl(file: any): string {
  const value = typeof file.url === 'string' ? file.url : typeof file.directPath === 'string' && file.directPath.startsWith('/') && !file.directPath.startsWith('//')
    ? 'https://mmg.whatsapp.net' + file.directPath : '';
  let url: URL;
  try { url = new URL(value); } catch { throw codedError('MEDIA_URL_INVALID', 422); }
  if (url.protocol !== 'https:' || url.hostname !== 'mmg.whatsapp.net' || url.port && url.port !== '443' || url.username || url.password || url.hash) throw codedError('MEDIA_URL_NOT_ALLOWED', 422);
  return url.href;
}
/** Own HTTP transport: the rc14 helper drops AbortSignal before fetch. Never
 * replace global fetch or patch node_modules. Key derivation stays with the SDK;
 * Node verifies the complete encrypted envelope before exposing plaintext.
 * Bounded buffering is deliberate: unauthenticated bytes never reach storage. */
export async function downloadVerifiedMedia(message: any, external: AbortSignal, timeoutMs: number,
  policy: FilePolicy, derive: MediaKeyResolver, request: MediaFetch = fetch): Promise<AsyncIterable<Uint8Array>> {
  const normalized = normalizeProviderMessage('00000000-0000-4000-8000-000000000000', message, 'append', Date.now(), true);
  if (!normalized?.metadata) throw codedError('MEDIA_MESSAGE_INVALID', 422);
  const metadata = policy.metadata(normalized.metadata), content = contentOf(message);
  const file = content?.imageMessage ?? content?.audioMessage ?? content?.videoMessage ?? content?.documentMessage;
  const key = bytes(file?.mediaKey, 32), expected = bytes(file?.fileSha256, 32);
  const encryptedHash = file.fileEncSha256 ? bytes(file.fileEncSha256, 32) : null;
  const url = mediaUrl(file), controller = new AbortController();
  const abort = () => controller.abort(external.reason ?? codedError('MEDIA_DOWNLOAD_ABORTED'));
  external.addEventListener('abort', abort, { once: true });
  if (external.aborted) abort();
  const timer = setTimeout(() => controller.abort(codedError('MEDIA_DOWNLOAD_TIMEOUT')), timeoutMs); timer.unref();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    controller.signal.throwIfAborted();
    const response = await request(url, { signal: controller.signal, redirect: 'error', credentials: 'omit', cache: 'no-store', headers: { Origin: 'https://web.whatsapp.com' } });
    controller.signal.throwIfAborted();
    if (!response.ok) {
      const error = codedError('MEDIA_HTTP_FAILED'); Object.assign(error, { output: { statusCode: response.status } }); throw error;
    }
    if (!response.body) throw codedError('MEDIA_BODY_MISSING');
    const limit = policy.limits[metadata.kind] + 16 + 10;
    const announced = response.headers.get('content-length');
    if (announced && (!/^\d+$/.test(announced) || Number(announced) > limit)) throw codedError('MEDIA_SIZE_LIMIT', 413);
    reader = response.body.getReader();
    const chunks: Buffer[] = []; let size = 0;
    for (;;) {
      const item = await reader.read(); controller.signal.throwIfAborted(); if (item.done) break;
      size += item.value.byteLength; if (size > limit) throw codedError('MEDIA_SIZE_LIMIT', 413);
      chunks.push(Buffer.from(item.value));
    }
    const envelope = Buffer.concat(chunks, size);
    if (envelope.length < 26 || (envelope.length - 10) % 16) throw codedError('MEDIA_ENVELOPE_INVALID', 422);
    if (encryptedHash && !timingSafeEqual(createHash('sha256').update(envelope).digest(), encryptedHash)) throw codedError('MEDIA_ENCRYPTED_HASH_MISMATCH', 422);
    const keys = await derive(key, metadata.kind); controller.signal.throwIfAborted();
    const iv = bytes(keys.iv, 16), cipherKey = bytes(keys.cipherKey, 32), macKey = bytes(keys.macKey, 32);
    const ciphertext = envelope.subarray(0, -10);
    const mac = createHmac('sha256', macKey).update(iv).update(ciphertext).digest().subarray(0, 10);
    if (!timingSafeEqual(mac, envelope.subarray(-10))) throw codedError('MEDIA_MAC_MISMATCH', 422);
    let plaintext: Buffer;
    try { const decipher = createDecipheriv('aes-256-cbc', cipherKey, iv); plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]); }
    catch { throw codedError('MEDIA_DECRYPT_FAILED', 422); }
    if (!timingSafeEqual(createHash('sha256').update(plaintext).digest(), expected)) throw codedError('MEDIA_PLAINTEXT_HASH_MISMATCH', 422);
    const length = file.fileLength?.toNumber?.() ?? (typeof file.fileLength === 'object' && file.fileLength !== null ? file.fileLength.high * 4294967296 + (file.fileLength.low >>> 0) : Number(file.fileLength));
    if (file.fileLength != null && (!Number.isSafeInteger(length) || length !== plaintext.length)) throw codedError('MEDIA_LENGTH_MISMATCH', 422);
    policy.validate(plaintext, metadata); controller.signal.throwIfAborted();
    return (async function* () { external.throwIfAborted(); yield plaintext; })();
  } catch (error) {
    controller.abort(error);
    throw external.aborted ? external.reason : controller.signal.reason ?? codedError('MEDIA_DOWNLOAD_FAILED');
  } finally {
    clearTimeout(timer); external.removeEventListener('abort', abort);
    if (reader) { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  }
}
