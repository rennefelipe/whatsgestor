import { ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { WhatsappMessage } from '../whatsapp-conversations/entities/whatsapp-message.entity';
import { WhatsappMessageMedia } from '../whatsapp-conversations/entities/whatsapp-message-media.entity';
import { FilePolicy, canonicalMime, type FileMetadata } from './file-policy';
import { PrivateFileStorage } from './private-file-storage';

@Injectable()
export class MessageFilesService {
  private active = 0;
  constructor(private readonly database: DataSource, private readonly storage: PrivateFileStorage, private readonly policy: FilePolicy) {}
  async recordUnavailable(conversationId: string, messageId: string, input: FileMetadata, size?: number) {
    const metadata = this.policy.metadata(input);
    return this.database.transaction(async (manager) => {
      const message = await manager.getRepository(WhatsappMessage).findOne({
        where: { id: messageId, conversationId }, lock: { mode: 'pessimistic_write' },
      });
      if (!message) throw new NotFoundException('Mensagem nao encontrada nesta conversa.');
      if (message.messageType !== metadata.kind) throw new ConflictException('Tipo do arquivo diverge da mensagem.');
      const repository = manager.getRepository(WhatsappMessageMedia);
      const existing = await repository.findOneBy({ messageId });
      // A bad redelivery never downgrades a previously available attachment.
      if (existing?.availability === 'ready' || existing?.availability === 'failed') return;
      const values = { kind: metadata.kind === 'video' ? 'document' as const : metadata.kind,
        mimeType: metadata.mimeType, originalName: metadata.originalName, durationSeconds: metadata.durationSeconds ?? null,
        sizeBytes: Number.isSafeInteger(size) && size! > 0 && size! <= 20971520 ? size! : null, availability: 'failed' as const };
      if (existing) await repository.update(existing.id, values);
      else await repository.save(repository.create({ messageId, ...values }));
    });
  }
  async recover(conversationId: string, messageId: string, key: string) {
    const recovered = await this.storage.recoverable(key, { conversationId, messageId });
    return this.attach(conversationId, messageId, recovered.content, recovered.metadata, key);
  }
  async attach(conversationId: string, messageId: string, content: Buffer, input: FileMetadata, recoveryKey?: string) {
    const metadata = this.policy.validate(content, input);
    if (this.active >= this.policy.concurrency) throw new ServiceUnavailableException('Limite de processamento de arquivos atingido.');
    content = Buffer.from(content);
    this.active++;
    try {
      return await this.database.transaction(async (manager) => {
        const message = await manager.getRepository(WhatsappMessage).findOne({
          where: { id: messageId, conversationId }, lock: { mode: 'pessimistic_write' },
        });
        if (!message) throw new NotFoundException('Mensagem nao encontrada nesta conversa.');
        // Video is represented by messageType + MIME; the legacy SQL kind CHECK
        // permits only image/audio/document. Do not alter its constraint.
        const kind = metadata.kind === 'video' ? 'document' : metadata.kind;
        if (message.messageType !== metadata.kind && !(metadata.kind === 'document' && message.messageType === 'document')) {
          throw new ConflictException('Tipo do arquivo diverge da mensagem.');
        }
        const repository = manager.getRepository(WhatsappMessageMedia);
        const existing = await repository.findOne({ where: { messageId }, select: {
          id: true, messageId: true, kind: true, mimeType: true, originalName: true,
          sizeBytes: true, durationSeconds: true, availability: true, storageKey: true,
        } });
        if (existing && (existing.kind !== kind || canonicalMime(existing.mimeType) !== canonicalMime(metadata.mimeType) ||
          existing.originalName !== metadata.originalName || (existing.durationSeconds ?? null) !== metadata.durationSeconds)) {
          throw new ConflictException('Metadados divergentes para a mesma mensagem.');
        }
        if (existing?.availability === 'ready') {
          if (!existing.storageKey || existing.sizeBytes !== metadata.sizeBytes || await this.storage.digest(existing.storageKey) !== metadata.sha256) {
            throw new ConflictException('Arquivo divergente ou indisponivel; o registro original foi preservado.');
          }
          return this.publicMetadata(existing, metadata.kind);
        }
        // Local bounded IO only; no provider/network operation is performed
        // while holding the message lock. A SQL failure leaves the published
        // private file recoverable rather than deleting a possibly committed file.
        const saved = recoveryKey ? await this.storage.recoverable(recoveryKey, { conversationId, messageId }) :
          await this.storage.save(content, metadata, { conversationId, messageId });
        if (saved.sha256 !== metadata.sha256) throw new ConflictException('Arquivo recuperado diverge do conteudo.');
        const values = { kind, mimeType: metadata.mimeType, originalName: metadata.originalName,
          sizeBytes: saved.size, durationSeconds: metadata.durationSeconds ?? null,
          storageKey: saved.key, availability: 'ready' as const };
        if (existing) await repository.update(existing.id, values);
        else await repository.save(repository.create({ messageId, ...values }));
        return this.publicMetadata({ ...existing, ...values }, metadata.kind);
      });
    } finally { this.active--; }
  }
  private publicMetadata(row: Partial<WhatsappMessageMedia>, semanticKind?: string) {
    return { kind: row.kind, semanticKind: semanticKind ?? (canonicalMime(row.mimeType ?? '').startsWith('video/') ? 'video' : row.kind),
      mimeType: row.mimeType, originalName: row.originalName, sizeBytes: row.sizeBytes,
      durationSeconds: row.durationSeconds, availability: row.availability };
  }
  async find(conversationId: string, messageId: string) {
    const message = await this.database.getRepository(WhatsappMessage).findOne({ where: { id: messageId, conversationId }, select: { id: true } });
    if (!message) throw new NotFoundException('Mensagem nao encontrada nesta conversa.');
    const media = await this.database.getRepository(WhatsappMessageMedia).findOne({
      where: { messageId }, select: { id: true, kind: true, mimeType: true, originalName: true,
        availability: true, storageKey: true, sizeBytes: true, durationSeconds: true },
    });
    if (!media) throw new NotFoundException('Arquivo nao encontrado nesta conversa.');
    return media;
  }
  async metadata(conversationId: string, messageId: string) {
    const media = await this.find(conversationId, messageId);
    return { ...this.publicMetadata(media), ...(media.storageKey ? await this.storage.extra(media.storageKey) : {}) };
  }
  async file(conversationId: string, messageId: string) {
    const media = await this.find(conversationId, messageId);
    if (media.availability !== 'ready' || !media.storageKey) throw new ServiceUnavailableException('Arquivo ainda indisponivel; mensagem preservada.');
    const file = await this.storage.open(media.storageKey);
    if (media.sizeBytes !== null && media.sizeBytes !== file.size) {
      await file.handle.close(); throw new ConflictException('Tamanho do arquivo diverge dos metadados.');
    }
    // Historical MIME/name values remain in SQL. Only HTTP headers are sanitized.
    const normalizedMime = typeof media.mimeType === 'string' ? canonicalMime(media.mimeType) : '';
    const mimeType = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(normalizedMime)
      ? normalizedMime : 'application/octet-stream';
    const name = (media.originalName ?? 'arquivo').replace(/[\x00-\x1f\x7f]/g, '').replace(/[\\/]/g, '_').slice(0, 255) || 'arquivo';
    return { ...file, mimeType, name };
  }
}
