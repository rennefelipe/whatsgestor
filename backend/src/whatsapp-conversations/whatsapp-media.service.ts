import { whatsappMediaEnabled } from './media-feature';
import { receiveDiagnostic } from './receive-diagnostics';
import {
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { Readable } from 'node:stream';
import type { IncomingMedia } from './incoming-media';
import { PrivateMediaStorage } from './private-media-storage';
import { WhatsappMessageMedia } from './entities/whatsapp-message-media.entity';
import type { WhatsappMessage } from './entities/whatsapp-message.entity';

export type MediaDownload = (signal: AbortSignal) => Promise<Readable>;
@Injectable()
export class WhatsappMediaService {
  private readonly logger = new Logger(WhatsappMediaService.name);
  private readonly storage = new PrivateMediaStorage();
  private downloads = 0;
  private readonly waitingDownloads: Array<() => void> = [];
  private async acquireDownload(): Promise<boolean> {
    if (this.downloads < 4) {
      this.downloads++;
      return true;
    }
    if (this.waitingDownloads.length >= 64) return false;
    await new Promise<void>((resolve) => this.waitingDownloads.push(resolve));
    return true;
  }
  private releaseDownload(): void {
    const next = this.waitingDownloads.shift();
    if (next) next();
    else this.downloads--;
  }
  constructor(
    @InjectRepository(WhatsappMessageMedia)
    private readonly media: Repository<WhatsappMessageMedia>,
  ) {}
  async receive(
    message: WhatsappMessage,
    metadata: IncomingMedia,
    download?: MediaDownload,
  ): Promise<void> {
    const existing = await this.media.findOneBy({ messageId: message.id });
    if (existing) {
      receiveDiagnostic('media_existing', {
        availability: existing.availability,
      });
      return;
    }
    let row: WhatsappMessageMedia;
    try {
      row = await this.media.save(
        this.media.create({
          messageId: message.id,
          kind: metadata.kind,
          mimeType: metadata.mimeType,
          originalName: metadata.originalName,
          durationSeconds: metadata.durationSeconds,
          availability: 'pending',
        }),
      );
    } catch (error) {
      if (await this.media.findOneBy({ messageId: message.id })) return;
      throw error;
    }
    // SQL operations above have completed before any network or filesystem download.
    receiveDiagnostic('media_pending', { kind: metadata.kind });
    const age = Date.now() - (message.messageTimestamp?.getTime() ?? 0);
    if (
      !download ||
      age > 24 * 60 * 60 * 1000 ||
      age < -5 * 60 * 1000 ||
      !(await this.acquireDownload())
    ) {
      await this.media.update(row.id, { availability: 'failed' });
      receiveDiagnostic('media_failed', {
        reason: !download
          ? 'missing_downloader'
          : age > 24 * 60 * 60 * 1000
            ? 'too_old'
            : age < -5 * 60 * 1000
              ? 'future_timestamp'
              : 'queue_full',
      });
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000);
    let key: string | undefined;
    try {
      const stream = await download(controller.signal);
      const saved = await this.storage.save(
        stream,
        metadata,
        controller.signal,
      );
      key = saved.key;
      await this.media.update(row.id, {
        storageKey: key,
        sizeBytes: saved.size,
        availability: 'ready',
      });
      receiveDiagnostic('media_ready', {
        kind: metadata.kind,
        sizeBytes: saved.size,
      });
    } catch {
      if (key) await this.storage.remove(key).catch(() => undefined);
      await this.media.update(row.id, { availability: 'failed' });
      this.logger.warn('whatsapp_media_download_failed');
      receiveDiagnostic('media_failed', {
        reason: 'download_storage_or_validation',
      });
    } finally {
      clearTimeout(timer);
      this.releaseDownload();
    }
  }
  async file(conversationId: string, messageId: string) {
    if (!whatsappMediaEnabled())
      throw new ServiceUnavailableException(
        'Recebimento de mídia ainda não habilitado.',
      );
    const row = await this.media
      .createQueryBuilder('media')
      .addSelect('media.storageKey')
      .innerJoin('media.message', 'message')
      .where(
        'media.messageId = :messageId AND message.conversationId = :conversationId',
        { messageId, conversationId },
      )
      .getOne();
    if (!row)
      throw new NotFoundException('Mídia não encontrada nesta conversa.');
    if (row.availability !== 'ready' || !row.storageKey)
      throw new ServiceUnavailableException('Mídia indisponível.');
    try {
      return {
        ...(await this.storage.read(row.storageKey)),
        mimeType: row.mimeType,
        name:
          row.originalName ??
          (row.kind === 'document'
            ? 'documento.pdf'
            : row.kind === 'audio'
              ? 'audio'
              : 'imagem'),
        kind: row.kind,
      };
    } catch {
      throw new NotFoundException('Arquivo de mídia indisponível.');
    }
  }
}
