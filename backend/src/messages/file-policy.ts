import { BadRequestException, Injectable, PayloadTooLargeException, UnsupportedMediaTypeException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { extname } from 'node:path';
import { createHash } from 'node:crypto';
import { TextDecoder } from 'node:util';

export type FileKind = 'image' | 'audio' | 'video' | 'document';
export interface FileMetadata {
  kind: FileKind;
  mimeType: string;
  originalName: string | null;
  durationSeconds?: number | null;
  width?: number;
  height?: number;
}
const formats: Record<string, { kind: FileKind; extensions: string[] }> = {
  'image/jpeg': { kind: 'image', extensions: ['.jpg', '.jpeg'] },
  'image/png': { kind: 'image', extensions: ['.png'] },
  'image/webp': { kind: 'image', extensions: ['.webp'] },
  'image/gif': { kind: 'image', extensions: ['.gif'] },
  'audio/webm': { kind: 'audio', extensions: ['.webm'] },
  'audio/ogg': { kind: 'audio', extensions: ['.ogg', '.opus'] },
  'audio/mpeg': { kind: 'audio', extensions: ['.mp3'] },
  'audio/wav': { kind: 'audio', extensions: ['.wav'] },
  'audio/mp4': { kind: 'audio', extensions: ['.m4a'] },
  'audio/aac': { kind: 'audio', extensions: ['.aac'] },
  'video/mp4': { kind: 'video', extensions: ['.mp4'] },
  'video/webm': { kind: 'video', extensions: ['.webm'] },
  'application/pdf': { kind: 'document', extensions: ['.pdf'] },
  'text/plain': { kind: 'document', extensions: ['.txt'] },
  'text/csv': { kind: 'document', extensions: ['.csv'] },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { kind: 'document', extensions: ['.docx'] },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { kind: 'document', extensions: ['.xlsx'] },
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': { kind: 'document', extensions: ['.pptx'] },
};
const zipEntry: Record<string, string> = {
  '.docx': 'word/document.xml', '.xlsx': 'xl/workbook.xml', '.pptx': 'ppt/presentation.xml',
};

function officeContainer(data: Buffer, extension: string): boolean {
  // Inspect central-directory metadata only. Never extract or execute documents.
  let end = -1;
  for (let p = data.length - 22; p >= Math.max(0, data.length - 65557); p--) {
    if (data.readUInt32LE(p) === 0x06054b50 && p + 22 + data.readUInt16LE(p + 20) === data.length) { end = p; break; }
  }
  if (end < 0 || data.readUInt16LE(end + 4) || data.readUInt16LE(end + 6)) return false;
  const count = data.readUInt16LE(end + 10), start = data.readUInt32LE(end + 16), length = data.readUInt32LE(end + 12);
  if (!count || count > 1024 || data.readUInt16LE(end + 8) !== count || start + length !== end) return false;
  let p = start, expanded = 0;
  const names = new Set<string>();
  for (let n = 0; n < count; n++) {
    if (p + 46 > end || data.readUInt32LE(p) !== 0x02014b50) return false;
    const flags = data.readUInt16LE(p + 8), method = data.readUInt16LE(p + 10);
    const packed = data.readUInt32LE(p + 20), unpacked = data.readUInt32LE(p + 24);
    const nameLength = data.readUInt16LE(p + 28), extra = data.readUInt16LE(p + 30), comment = data.readUInt16LE(p + 32);
    const local = data.readUInt32LE(p + 42);
    if (p + 46 + nameLength + extra + comment > end || local + 30 > start || data.readUInt32LE(local) !== 0x04034b50) return false;
    const name = data.toString('utf8', p + 46, p + 46 + nameLength);
    const body = local + 30 + data.readUInt16LE(local + 26) + data.readUInt16LE(local + 28);
    if ((flags & 1) || ![0, 8].includes(method) || name.includes('\\') || name.startsWith('/') ||
      name.split('/').includes('..') || /[\x00-\x1f]/.test(name) || /vbaproject|\.bin$/i.test(name) || names.has(name) ||
      body + packed > start || unpacked > Math.max(1, packed) * 100 || (expanded += unpacked) > 100 * 1024 * 1024) return false;
    names.add(name); p += 46 + nameLength + extra + comment;
  }
  return p === end && names.has('[Content_Types].xml') && names.has(zipEntry[extension]);
}

export function canonicalMime(value: string): string {
  const mime = value.split(';')[0].trim().toLowerCase();
  return mime === 'audio/x-wav' ? 'audio/wav' : mime === 'image/jpg' ? 'image/jpeg' : mime;
}

@Injectable()
export class FilePolicy {
  readonly limits: Record<FileKind, number>;
  readonly maxTextLength: number;
  readonly concurrency: number;
  readonly uploadTimeoutMs: number;
  constructor(private readonly config: ConfigService) {
    const number = (name: string, fallback: number, max: number) => {
      const raw = config.get(name) ?? fallback;
      if (!/^\d+$/.test(String(raw)) || !Number.isSafeInteger(Number(raw)) || Number(raw) < 1 || Number(raw) > max) {
        throw new Error(`Configuracao invalida: ${name}.`);
      }
      return Number(raw);
    };
    const hardLimit = 20 * 1024 * 1024; // Existing SQL CHECK; never raise without a separately approved migration.
    this.limits = {
      image: number('MESSAGES_IMAGE_MAX_BYTES', 5 * 1024 * 1024, hardLimit),
      audio: number('MESSAGES_AUDIO_MAX_BYTES', 16 * 1024 * 1024, hardLimit),
      video: number('MESSAGES_VIDEO_MAX_BYTES', hardLimit, hardLimit),
      document: number('MESSAGES_DOCUMENT_MAX_BYTES', hardLimit, hardLimit),
    };
    this.maxTextLength = number('MESSAGES_TEXT_MAX_LENGTH', 4096, 65536);
    this.concurrency = number('MESSAGES_FILE_CONCURRENCY', 2, 8);
    this.uploadTimeoutMs = number('MESSAGES_UPLOAD_TIMEOUT_MS', 30000, 120000);
  }
  get maxBytes(): number { return Math.max(...Object.values(this.limits)); }
  get storageDirectory(): string | undefined { return this.config.get<string>('WHATSAPP_MEDIA_DIR'); }
  capabilities() { return { formats, limits: this.limits, maxTextLength: this.maxTextLength, providerConnected: false, databaseFileLimit: 20 * 1024 * 1024 }; }
  text(value: unknown): string {
    if (typeof value !== 'string' || !value.trim() || value.includes('\0')) throw new BadRequestException('Texto invalido.');
    if (value.length > this.maxTextLength) throw new PayloadTooLargeException('Texto excede o limite configurado.');
    return value;
  }
  metadata(input: FileMetadata): FileMetadata {
    if (!input || typeof input.mimeType !== 'string' || input.mimeType.length > 100 || /[\x00-\x1f\x7f]/.test(input.mimeType)) throw new BadRequestException('Metadados invalidos.');
    const mimeType = canonicalMime(input.mimeType), format = formats[mimeType];
    if (!format || input.kind !== format.kind) throw new UnsupportedMediaTypeException('Tipo de arquivo nao suportado.');
    if (input.originalName !== null && (typeof input.originalName !== 'string' || !input.originalName.trim() || input.originalName.length > 255 ||
      /[\\/\x00-\x1f\x7f<>:"|?*]/.test(input.originalName) || /[. ]$/.test(input.originalName) ||
      !format.extensions.includes(extname(input.originalName).toLowerCase()))) throw new BadRequestException('Nome ou extensao invalida.');
    for (const key of ['durationSeconds', 'width', 'height'] as const) {
      const value = input[key];
      if (value != null && (!Number.isSafeInteger(value) || value < (key === 'durationSeconds' ? 0 : 1) || value > 2147483647)) throw new BadRequestException('Metadados invalidos.');
    }
    return { kind: format.kind, mimeType: input.mimeType, originalName: input.originalName, durationSeconds: input.durationSeconds ?? null,
      ...(input.width != null ? { width: input.width } : {}), ...(input.height != null ? { height: input.height } : {}) };
  }
  validate(content: Buffer, input: FileMetadata) {
    const metadata = this.metadata(input);
    if (!Buffer.isBuffer(content) || content.length === 0) throw new BadRequestException('Arquivo vazio.');
    if (content.length > this.limits[metadata.kind]) throw new PayloadTooLargeException('Arquivo excede o limite configurado.');
    const s = (a: number, b: number) => content.toString('ascii', a, b);
    const mime = canonicalMime(metadata.mimeType);
    let valid = false;
    if (mime === 'image/png') valid = content.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
    if (mime === 'image/jpeg') valid = content[0] === 255 && content[1] === 216 && content[2] === 255;
    if (mime === 'image/webp') valid = s(0, 4) === 'RIFF' && s(8, 12) === 'WEBP';
    if (mime === 'image/gif') valid = ['GIF87a', 'GIF89a'].includes(s(0, 6));
    if (mime === 'audio/ogg') valid = s(0, 4) === 'OggS';
    if (mime === 'audio/wav') valid = s(0, 4) === 'RIFF' && s(8, 12) === 'WAVE';
    if (mime === 'audio/mpeg') valid = s(0, 3) === 'ID3' || (content[0] === 255 && (content[1] & 224) === 224 && (content[1] & 6) !== 0);
    if (mime === 'audio/aac') valid = content[0] === 255 && (content[1] & 246) === 240;
    if (mime === 'audio/mp4' || mime === 'video/mp4') valid = content.length >= 12 && s(4, 8) === 'ftyp' &&
      ['isom', 'iso2', 'mp41', 'mp42', 'avc1', 'M4A ', 'M4V ', 'dash'].includes(s(8, 12));
    if (mime === 'audio/webm' || mime === 'video/webm') valid = content.subarray(0, 4).equals(Buffer.from([26,69,223,163])) && content.subarray(0,4096).includes(Buffer.from('webm'));
    if (mime === 'audio/webm') valid = valid && content.includes(Buffer.from('A_OPUS')) && !content.includes(Buffer.from('V_VP8')) && !content.includes(Buffer.from('V_VP9')) && !content.includes(Buffer.from('V_AV1'));
    if (mime === 'application/pdf') valid = s(0, 5) === '%PDF-';
    if (mime === 'text/plain' || mime === 'text/csv') {
      try { const text = new TextDecoder('utf-8', { fatal: true }).decode(content); valid = !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text); } catch { valid = false; }
    }
    if (mime.includes('openxmlformats')) valid = officeContainer(content, formats[mime].extensions[0]);
    if (!valid) throw new UnsupportedMediaTypeException('Conteudo incompativel com o tipo informado.');
    return { ...metadata, sizeBytes: content.length, sha256: createHash('sha256').update(content).digest('hex') };
  }
}
