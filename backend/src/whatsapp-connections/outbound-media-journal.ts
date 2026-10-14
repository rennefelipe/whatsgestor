import {
  mkdir,
  open,
  rename,
  readdir,
  readFile,
  rm,
  realpath,
  lstat,
} from 'node:fs/promises';
import { join, sep } from 'node:path';
import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { PrivateMediaStorage } from '../whatsapp-conversations/private-media-storage';
import type { AttachmentMetadata } from './attachment-validation';
import type { AudioMetadata } from './outbound-audio';

export type JournalState =
  | 'prepared'
  | 'sending'
  | 'confirmed'
  | 'registered'
  | 'uncertain'
  | 'failed'
  | 'reviewed';
export interface OutboundRecord {
  version: 1;
  id: string;
  userId: string;
  conversationId: string;
  connectionId: string;
  remoteJid: string;
  metadata: AttachmentMetadata | AudioMetadata;
  storageKey: string;
  digest: string;
  sourceDigest?: string;
  state: JournalState;
  createdAt: string;
  whatsappMessageId?: string;
  timestamp?: string;
  messageId?: string;
}
export function validOutboundRecord(record: OutboundRecord): boolean {
  const uuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const metadata = record?.metadata;
  const confirmed = ['confirmed', 'registered'].includes(record?.state);
  return (
    record?.version === 1 &&
    [
      record.id,
      record.userId,
      record.conversationId,
      record.connectionId,
    ].every((value) => typeof value === 'string' && uuid.test(value)) &&
    /^[^@\s]+@(?:s\.whatsapp\.net|lid)$/.test(record.remoteJid) &&
    typeof metadata?.originalName === 'string' &&
    metadata.originalName.length > 0 &&
    metadata.originalName.length <= 255 &&
    !/[\\/]/.test(metadata.originalName) &&
    ![...metadata.originalName].some(
      (character) => character.charCodeAt(0) < 32,
    ) &&
    (metadata.kind === 'image'
      ? ['image/jpeg', 'image/png', 'image/webp'].includes(metadata.mimeType)
      : metadata.kind === 'document'
        ? metadata.mimeType === 'application/pdf'
        : metadata.kind === 'audio' &&
          metadata.mimeType === 'audio/ogg' &&
          Number.isSafeInteger(metadata.durationSeconds) &&
          metadata.durationSeconds > 0 &&
          metadata.durationSeconds <= 5 * 60) &&
    Number.isSafeInteger(metadata.size) &&
    metadata.size > 0 &&
    metadata.size <=
      (metadata.kind === 'image' ? 5 : metadata.kind === 'audio' ? 16 : 20) *
        1024 *
        1024 &&
    /^[0-9a-f]{64}$/.test(record.digest) &&
    (record.sourceDigest === undefined ||
      /^[0-9a-f]{64}$/.test(record.sourceDigest)) &&
    /^[0-9a-f-]{36}\.bin$/.test(record.storageKey) &&
    Number.isFinite(Date.parse(record.createdAt)) &&
    [
      'prepared',
      'sending',
      'confirmed',
      'registered',
      'uncertain',
      'failed',
      'reviewed',
    ].includes(record.state) &&
    (!confirmed ||
      (typeof record.whatsappMessageId === 'string' &&
        record.whatsappMessageId.length > 0 &&
        record.whatsappMessageId.length <= 255 &&
        !!record.timestamp &&
        Number.isFinite(Date.parse(record.timestamp)))) &&
    (record.state !== 'registered' ||
      (!!record.messageId && uuid.test(record.messageId)))
  );
}
export class OutboundMediaJournal {
  readonly directory: string;
  readonly records = new Map<string, OutboundRecord>();
  private lockOwned = false;
  constructor(readonly storage: PrivateMediaStorage) {
    this.directory = join(storage.root, '.outbound');
  }
  private file(id: string) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw Error('Invalid attempt ID');
    return join(this.directory, id.toLowerCase() + '.json');
  }
  async initialize() {
    await this.storage.ensureRoot();
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    if (
      (await lstat(this.directory)).isSymbolicLink() ||
      !(await realpath(this.directory)).startsWith(
        (await realpath(this.storage.root)) + sep,
      )
    )
      throw Error('Invalid journal directory');
    const lock = join(this.directory, '.lock');
    try {
      const prior = JSON.parse(await readFile(lock, 'utf8')) as {
        pid: number;
        host: string;
      };
      if (prior.host !== hostname() || !Number.isInteger(prior.pid))
        throw Error('Journal requires one backend instance');
      let alive = true;
      try {
        process.kill(prior.pid, 0);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ESRCH') alive = false;
      }
      if (alive) throw Error('Journal already in use by a backend instance');
      await rm(lock);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const handle = await open(lock, 'wx', 0o600);
    try {
      await handle.writeFile(
        JSON.stringify({ pid: process.pid, host: hostname() }),
      );
      await handle.sync();
      this.lockOwned = true;
    } finally {
      await handle.close();
    }
    for (const name of await readdir(this.directory)) {
      if (name.endsWith('.part')) {
        await rm(join(this.directory, name));
        continue;
      }
      if (!/^[0-9a-f-]{36}\.json$/i.test(name)) continue;
      if ((await lstat(join(this.directory, name))).isSymbolicLink())
        throw Error('Invalid journal record');
      const record = JSON.parse(
        await readFile(join(this.directory, name), 'utf8'),
      ) as OutboundRecord;
      if (!validOutboundRecord(record) || name !== record.id + '.json')
        throw Error('Corrupt journal; manual review required');
      this.records.set(record.id, record);
    }
  }
  async close() {
    if (this.lockOwned) {
      await rm(join(this.directory, '.lock'), { force: true });
      this.lockOwned = false;
    }
  }
  reserve() {
    const bytes = [...this.records.values()]
      .filter((record) => !['registered', 'failed'].includes(record.state))
      .reduce((total, record) => total + record.metadata.size, 0);
    if (
      this.records.size >= 10_000 ||
      bytes + 20 * 1024 * 1024 > 1024 * 1024 * 1024
    )
      throw new ServiceUnavailableException(
        'O diário de envios atingiu sua quota. Solicite revisão ao administrador.',
      );
  }
  async put(record: OutboundRecord) {
    if (!validOutboundRecord(record)) throw Error('Invalid journal record');
    const target = this.file(record.id),
      temporary = target + '.' + randomUUID() + '.part';
    const handle = await open(temporary, 'wx', 0o600);
    try {
      await handle.writeFile(JSON.stringify(record));
      await handle.sync();
      await handle.close();
      await rename(temporary, target);
      if (process.platform !== 'win32') {
        const directory = await open(this.directory, 'r');
        try {
          await directory.sync();
        } finally {
          await directory.close();
        }
      }
      this.records.set(record.id, { ...record });
    } catch (error) {
      await handle.close().catch(() => undefined);
      await rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
  }
  existing(
    id: string,
    userId: string,
    conversationId: string,
    digest?: string,
  ) {
    const record = this.records.get(id.toLowerCase());
    if (
      record &&
      (record.userId !== userId ||
        record.conversationId !== conversationId ||
        (digest && (record.sourceDigest ?? record.digest) !== digest))
    )
      throw new ConflictException(
        'A chave de envio já foi utilizada em outra solicitação.',
      );
    return record;
  }
}
