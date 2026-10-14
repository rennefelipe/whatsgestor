import {
  BadGatewayException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  type OnModuleInit,
  type OnModuleDestroy,
} from '@nestjs/common';
import { randomUUID, createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { WhatsappConversationsService } from '../whatsapp-conversations/whatsapp-conversations.service';
import { PrivateMediaStorage } from '../whatsapp-conversations/private-media-storage';
import { whatsappMediaEnabled } from '../whatsapp-conversations/media-feature';
import { WhatsappSessionManagerService } from './baileys/whatsapp-session-manager.service';
import {
  OutboundMediaJournal,
  type OutboundRecord,
} from './outbound-media-journal';
import {
  validateAttachment,
  type AttachmentMetadata,
  type AttachmentUpload,
} from './attachment-validation';
import { normalizeRecordedAudio, type AudioMetadata } from './outbound-audio';
import type { UserResponse } from '../users/users.service';

interface PreparedOutboundMedia {
  buffer: Buffer;
  metadata: AttachmentMetadata | AudioMetadata;
  sourceDigest?: string;
}

@Injectable()
export class WhatsappAttachmentSendingService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(WhatsappAttachmentSendingService.name);
  private readonly storage = new PrivateMediaStorage();
  private readonly journal = new OutboundMediaJournal(this.storage);
  private readonly active = new Set<string>();
  private ready = false;
  private recovering = false;
  private timer?: NodeJS.Timeout;
  constructor(
    private readonly conversations: WhatsappConversationsService,
    private readonly sessions: WhatsappSessionManagerService,
  ) {}
  async onModuleInit() {
    if (!whatsappMediaEnabled()) return;
    try {
      await this.journal.initialize();
      for (const record of this.journal.records.values()) {
        if (record.state === 'prepared' || record.state === 'failed') {
          await this.storage.discardPrepared(record.storageKey);
          await this.journal.put({ ...record, state: 'failed' });
        } else if (record.state === 'sending')
          await this.journal.put({ ...record, state: 'uncertain' });
      }
      this.ready = true;
      void this.recover();
      this.timer = setInterval(() => void this.recover(), 30_000);
      this.timer.unref();
    } catch {
      this.ready = false;
      this.logger.error('outbound_media_journal_unavailable');
      await this.journal.close().catch(() => undefined);
    }
  }
  async onModuleDestroy() {
    this.ready = false;
    if (this.timer) clearInterval(this.timer);
    // Keep the process lock if requests are still settling. Next startup treats
    // the dead process's sending records as uncertain, rather than resending.
    if (!this.active.size) await this.journal.close();
  }
  private checkReady() {
    if (!this.ready || !whatsappMediaEnabled())
      throw new ServiceUnavailableException(
        'Envio de anexos indisponível. Verifique mídia e diário privado no backend.',
      );
  }
  async preflight(conversationId: string, user: UserResponse) {
    this.checkReady();
    if (this.active.size >= 2)
      throw new ServiceUnavailableException(
        'Há muitos anexos em processamento. Aguarde as tentativas atuais.',
      );
    const conversation = await this.authorize(conversationId, user);
    await this.sessions.assertAttachmentConnection(conversation.connectionId);
  }
  private async authorize(conversationId: string, user: UserResponse) {
    const conversation = await this.conversations.findOne(conversationId);
    if (
      !user.isActive ||
      conversation.attendanceStatus !== 'in_progress' ||
      (!user.isAdmin &&
        conversation.assignedUserId?.toLowerCase() !== user.id.toLowerCase())
    )
      throw new ForbiddenException(
        'Inicie o atendimento e utilize o responsável ou um administrador para enviar anexos.',
      );
    if (!/^[^@\s]+@(?:s\.whatsapp\.net|lid)$/.test(conversation.remoteJid))
      throw new ForbiddenException(
        'Envio disponível somente para conversas individuais.',
      );
    return conversation;
  }
  private async persist(record: OutboundRecord) {
    // Persist only the acknowledged send. Neither this method nor recovery sends to WhatsApp.
    await this.journal.put({ ...record, state: 'confirmed' });
    const file = await this.storage.read(record.storageKey);
    const hash = createHash('sha256');
    for await (const chunk of file.stream) hash.update(chunk as Buffer);
    if (
      file.size !== record.metadata.size ||
      hash.digest('hex') !== record.digest
    )
      throw Error('Confirmed attachment unavailable');
    const message = await this.conversations.persistConfirmedAttachment(record);
    await this.journal.put({
      ...record,
      state: 'registered',
      messageId: message.id,
    });
    return message;
  }
  private async recover() {
    if (!this.ready || this.recovering) return;
    this.recovering = true;
    try {
      for (const record of this.journal.records.values()) {
        if (!this.ready) break;
        if (
          record.state !== 'confirmed' ||
          this.active.has(record.conversationId)
        )
          continue;
        this.active.add(record.conversationId);
        try {
          await this.persist(record);
        } catch {
          this.logger.warn('outbound_media_sql_recovery_pending');
        } finally {
          this.active.delete(record.conversationId);
        }
      }
    } finally {
      this.recovering = false;
    }
  }
  async send(
    conversationId: string,
    user: UserResponse,
    attemptId: string,
    file?: AttachmentUpload,
  ) {
    return this.sendPrepared(conversationId, user, attemptId, async () => {
      const metadata = await validateAttachment(file);
      return { buffer: file!.buffer, metadata };
    });
  }
  async sendAudio(
    conversationId: string,
    user: UserResponse,
    attemptId: string,
    file?: AttachmentUpload,
  ) {
    return this.sendPrepared(conversationId, user, attemptId, () =>
      normalizeRecordedAudio(file).then((normalized) => ({
        ...normalized,
        sourceDigest: createHash('sha256').update(file!.buffer).digest('hex'),
      })),
    );
  }
  private async sendPrepared(
    conversationId: string,
    user: UserResponse,
    attemptId: string,
    prepare: () => Promise<PreparedOutboundMedia>,
  ) {
    this.checkReady();
    conversationId = conversationId.toLowerCase();
    attemptId = attemptId.toLowerCase();
    if (this.active.has(conversationId))
      throw new ConflictException(
        'Já existe um envio ou registro em andamento nesta conversa.',
      );
    if (this.active.size >= 2)
      throw new ServiceUnavailableException(
        'Há muitos anexos em processamento. Aguarde as tentativas atuais.',
      );
    this.active.add(conversationId);
    let record: OutboundRecord | undefined;
    let transportInvoked = false;
    try {
      const prepared = await prepare();
      const metadata = prepared.metadata;
      const digest = createHash('sha256').update(prepared.buffer).digest('hex');
      record = this.journal.existing(
        attemptId,
        user.id.toLowerCase(),
        conversationId,
        prepared.sourceDigest ?? digest,
      );
      if (record) {
        if (record.state === 'registered' && record.messageId)
          return this.conversations.findMessage(
            conversationId,
            record.messageId,
          );
        if (record.state === 'confirmed') return this.persist(record);
        throw new ConflictException(
          'Esta tentativa já foi processada ou tem resultado incerto. Confira o WhatsApp; ela não será reenviada.',
        );
      }
      const conversation = await this.authorize(conversationId, user);
      if (
        [...this.journal.records.values()].some(
          (row) =>
            row.conversationId === conversationId &&
            ['uncertain', 'sending', 'confirmed'].includes(row.state),
        )
      )
        throw new ConflictException(
          'Há um envio pendente de registro ou conferência nesta conversa.',
        );
      await this.sessions.assertAttachmentConnection(conversation.connectionId);
      this.journal.reserve();
      record = {
        version: 1,
        id: attemptId,
        userId: user.id.toLowerCase(),
        conversationId,
        connectionId: conversation.connectionId,
        remoteJid: conversation.remoteJid,
        metadata,
        digest,
        ...(prepared.sourceDigest
          ? { sourceDigest: prepared.sourceDigest }
          : {}),
        storageKey: randomUUID() + '.bin',
        state: 'prepared',
        createdAt: new Date().toISOString(),
      };
      await this.journal.put(record);
      await this.storage.save(
        Readable.from(prepared.buffer),
        {
          ...metadata,
          durationSeconds:
            metadata.kind === 'audio' ? metadata.durationSeconds : null,
          caption: null,
          expectedHash: Buffer.from(digest, 'hex'),
        },
        new AbortController().signal,
        record.storageKey,
      );
      await this.storage.sync(record.storageKey);
      await this.authorize(conversationId, user);
      await this.sessions.assertAttachmentConnection(conversation.connectionId);
      record = { ...record, state: 'sending' };
      await this.journal.put(record);
      const stored = await this.storage.read(record.storageKey);
      let sent: Awaited<
        ReturnType<WhatsappSessionManagerService['sendAttachment']>
      >;
      let deadline: NodeJS.Timeout | undefined;
      try {
        transportInvoked = true;
        sent = await Promise.race([
          this.sessions.sendAttachment(record.connectionId, record.remoteJid, {
            ...metadata,
            stream: stored.stream,
          }),
          new Promise<never>((_resolve, reject) => {
            deadline = setTimeout(
              () =>
                reject(
                  new BadGatewayException(
                    'Tempo de confirmação excedido. Confira o WhatsApp; não reenvie automaticamente.',
                  ),
                ),
              60_000,
            );
          }),
        ]);
      } catch (error) {
        if (error instanceof ServiceUnavailableException) {
          record = { ...record, state: 'failed' };
          this.journal.records.set(record.id, record);
          await this.storage
            .discardPrepared(record.storageKey)
            .catch(() => this.logger.warn('outbound_media_cleanup_pending'));
          await this.journal.put(record);
        } else {
          record = { ...record, state: 'uncertain' };
          this.journal.records.set(record.id, record);
          await this.journal.put(record).catch(() => undefined);
        }
        throw error;
      } finally {
        if (deadline) clearTimeout(deadline);
        stored.stream.destroy();
      }
      record = {
        ...record,
        state: 'confirmed',
        whatsappMessageId: sent.whatsappMessageId,
        timestamp: (sent.messageTimestamp ?? new Date()).toISOString(),
      };
      this.journal.records.set(record.id, record);
      try {
        return await this.persist(record);
      } catch {
        this.logger.warn('outbound_media_confirmed_registration_pending');
        throw new BadGatewayException(
          'O WhatsApp aceitou o anexo; o registro local está pendente. Não reenvie. Consulte o estado desta tentativa.',
        );
      }
    } catch (error) {
      if (
        record &&
        (record.state === 'prepared' ||
          (record.state === 'sending' && !transportInvoked))
      ) {
        record = { ...record, state: 'failed' };
        this.journal.records.set(record.id, record);
        await this.storage
          .discardPrepared(record.storageKey)
          .catch(() => this.logger.warn('outbound_media_cleanup_pending'));
        await this.journal.put(record).catch(() => undefined);
      }
      throw error;
    } finally {
      this.active.delete(conversationId);
    }
  }
  async pending(conversationId: string, user: UserResponse) {
    this.checkReady();
    const records = [...this.journal.records.values()].filter(
      (row) =>
        row.conversationId === conversationId.toLowerCase() &&
        (row.userId === user.id.toLowerCase() || user.isAdmin) &&
        ['sending', 'confirmed', 'uncertain'].includes(row.state),
    );
    const record = records.sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    )[0];
    return record ? this.status(conversationId, user, record.id) : null;
  }
  async status(conversationId: string, user: UserResponse, id: string) {
    this.checkReady();
    let record = this.reviewableRecord(conversationId, user, id);
    if (!record) throw new NotFoundException('Tentativa não encontrada.');
    if (
      record.state === 'confirmed' &&
      !this.active.has(record.conversationId)
    ) {
      this.active.add(record.conversationId);
      try {
        await this.persist(record);
        record = this.journal.records.get(record.id)!;
      } catch {
        /* Local recovery remains pending; no resend. */
      } finally {
        this.active.delete(record.conversationId);
      }
    }
    return {
      id: record.id,
      state: record.state,
      kind: record.metadata.kind,
      originalName: record.metadata.originalName,
      message:
        record.state === 'registered' && record.messageId
          ? await this.conversations.findMessage(
              record.conversationId,
              record.messageId,
            )
          : null,
    };
  }
  async review(conversationId: string, user: UserResponse, id: string) {
    this.checkReady();
    await this.authorize(conversationId, user);
    const record = this.reviewableRecord(conversationId, user, id);
    if (!record) throw new NotFoundException('Tentativa não encontrada.');
    if (
      !record ||
      record.state !== 'uncertain' ||
      this.active.has(conversationId.toLowerCase())
    )
      throw new ConflictException(
        'Somente resultados incertos podem ser liberados após conferência manual.',
      );
    await this.journal.put({ ...record, state: 'reviewed' });
    return { id: record.id, state: 'reviewed' };
  }
  private reviewableRecord(
    conversationId: string,
    user: UserResponse,
    id: string,
  ) {
    const record = this.journal.records.get(id.toLowerCase());
    if (
      record &&
      (record.conversationId !== conversationId.toLowerCase() ||
        (!user.isAdmin && record.userId !== user.id.toLowerCase()))
    )
      throw new ForbiddenException(
        'Tentativa indisponível para este usuário e conversa.',
      );
    return record;
  }
}
