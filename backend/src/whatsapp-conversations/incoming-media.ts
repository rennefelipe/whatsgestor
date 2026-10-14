import type { WAMessage } from '@whiskeysockets/baileys';

export interface IncomingMedia {
  kind: 'image' | 'document' | 'audio';
  mimeType: string;
  originalName: string | null;
  durationSeconds: number | null;
  caption: string | null;
  expectedHash: Uint8Array | null;
}
export function incomingMedia(message: WAMessage): IncomingMedia | null {
  let content = message.message;
  // Do not retain view-once media. Unwrap ordinary ephemeral/caption containers only.
  for (let i = 0; i < 3; i++) {
    const inner =
      content?.ephemeralMessage?.message ??
      content?.documentWithCaptionMessage?.message;
    if (!inner) break;
    content = inner;
  }
  const media =
    content?.imageMessage ?? content?.documentMessage ?? content?.audioMessage;
  if (!media || !media.mediaKey || (!media.directPath && !media.url))
    return null;
  const kind = content?.imageMessage
    ? 'image'
    : content?.documentMessage
      ? 'document'
      : 'audio';
  const mimeType = media.mimetype?.split(';')[0].trim().toLowerCase() ?? '';
  const allowed =
    kind === 'image'
      ? ['image/jpeg', 'image/png', 'image/webp']
      : kind === 'document'
        ? ['application/pdf']
        : [
            'audio/ogg',
            'audio/mpeg',
            'audio/mp4',
            'audio/aac',
            'audio/wav',
            'audio/x-wav',
          ];
  if (!allowed.includes(mimeType)) return null;
  if (media.directPath && !media.directPath.startsWith('/')) return null;
  if (media.url) {
    try {
      const url = new URL(media.url);
      if (
        url.protocol !== 'https:' ||
        (url.port !== '' && url.port !== '443') ||
        url.username ||
        url.password ||
        !/^(?:[a-z0-9-]+\.)*(?:whatsapp\.net|whatsapp\.com)$/.test(url.hostname)
      )
        return null;
    } catch {
      return null;
    }
  }
  const name = content?.documentMessage?.fileName;
  const safeName = name
    ? Array.from(name)
        .map((character) =>
          character.charCodeAt(0) < 32 ||
          character.charCodeAt(0) === 127 ||
          '<>:"/\\|?*'.includes(character)
            ? '_'
            : character,
        )
        .join('')
        .slice(0, 250)
    : null;
  const originalName = safeName
    ? /\.pdf$/i.test(safeName)
      ? safeName
      : safeName + '.pdf'
    : null;
  const seconds = content?.audioMessage?.seconds;
  return {
    kind,
    mimeType,
    originalName,
    caption:
      content?.imageMessage?.caption ??
      content?.documentMessage?.caption ??
      null,
    durationSeconds:
      typeof seconds === 'number' &&
      Number.isInteger(seconds) &&
      seconds >= 0 &&
      seconds <= 2147483647
        ? seconds
        : null,
    expectedHash: media.fileSha256 ?? null,
  };
}
