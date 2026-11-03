import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { isUUID } from 'class-validator';
import { CONVERSATION_MESSAGE_RECORDS, type ConversationMessageRecords, type MessageRecordInput } from '../whatsapp-conversations/message-record.port';
import { WhatsappConversationsService } from '../whatsapp-conversations/whatsapp-conversations.service';
import { WhatsappConversation } from '../whatsapp-conversations/entities/whatsapp-conversation.entity';
import { WhatsappMessage } from '../whatsapp-conversations/entities/whatsapp-message.entity';
import { FilePolicy, type FileMetadata } from './file-policy';
import { MessageFilesService } from './message-files.service';
import { MESSAGE_STATES, type MessageReceipt } from './message-provider.port';
import type { UserResponse } from '../users/users.service';

@Injectable()
export class MessagesService {
  private activeFiles = 0;
  constructor(@Inject(CONVERSATION_MESSAGE_RECORDS) private readonly records: ConversationMessageRecords,
    private readonly files: MessageFilesService, private readonly policy: FilePolicy,
    private readonly conversations: WhatsappConversationsService) {}
  async capabilities(conversationId: string) { await this.conversations.findOne(conversationId); return this.policy.capabilities(); }
  async authorizePreparation(conversationId: string, actor: Pick<UserResponse, 'id' | 'isAdmin' | 'isActive'>) {
    const conversation = await this.conversations.findOne(conversationId);
    if (!actor?.isActive || conversation.attendanceStatus !== 'in_progress' ||
      (!actor.isAdmin && conversation.assignedUserId !== actor.id)) throw new ForbiddenException('Preparacao permitida somente ao responsavel ou administrador durante o atendimento.');
  }
  async prepareText(conversationId: string, text: unknown, actor: Pick<UserResponse, 'id' | 'isAdmin' | 'isActive'>) {
    await this.authorizePreparation(conversationId, actor);
    return { state: 'prepared', kind: 'text', textContent: this.policy.text(text),
      persisted: false, queued: false, providerConnected: false };
  }
  async prepareFile(conversationId: string, content: Buffer, metadata: FileMetadata, actor: Pick<UserResponse, 'id' | 'isAdmin' | 'isActive'>) {
    await this.authorizePreparation(conversationId, actor);
    return { state: 'prepared', ...this.policy.validate(content, metadata), persisted: false, queued: false, providerConnected: false };
  }
  async unavailable(conversationId: string): Promise<never> {
    await this.conversations.findOne(conversationId);
    throw new ServiceUnavailableException({ statusCode: 503, code: 'MESSAGE_PROVIDER_UNAVAILABLE',
      message: 'Integracao de mensagens ainda nao autorizada. Nenhuma mensagem foi enviada ou enfileirada.' });
  }
  /** Internal adapter boundary: retries use the original provider ID, never a generated replacement. */
  async ingest(input: MessageRecordInput, attachment?: { metadata: FileMetadata; content: Buffer }) {
    const value = { ...input, messageTimestamp: input.messageTimestamp ? new Date(input.messageTimestamp) : input.messageTimestamp };
    if (attachment && value.messageType === undefined) value.messageType = attachment.metadata.kind;
    if (value.messageType === undefined || value.messageType === 'text') this.policy.text(value.textContent);
    if (value.status !== undefined && !MESSAGE_STATES.includes(value.status as typeof MESSAGE_STATES[number])) throw new BadRequestException('Estado de mensagem invalido.');
    let validationError: unknown;
    if (attachment) {
      try { this.policy.validate(attachment.content, attachment.metadata); } catch (error) { validationError = error; }
      if (this.activeFiles >= this.policy.concurrency) throw new ServiceUnavailableException('Limite de processamento de arquivos atingido.');
      // Do not copy an oversized/invalid payload. Its message identity is still
      // recorded below, and valid metadata can describe a failed attachment.
      attachment = { content: validationError ? Buffer.alloc(0) : Buffer.from(attachment.content), metadata: { ...attachment.metadata } };
      this.activeFiles++;
    }
    try {
      const outcome=this.records.recordWithOutcome ? await this.records.recordWithOutcome(value) : {message:await this.records.record(value),duplicate:false};
      const {message}=outcome;
      if (attachment && validationError) {
        await this.files.recordUnavailable(message.conversationId, message.id, attachment.metadata);
        throw validationError;
      }
      // If attachment persistence fails, propagate the error. The message and its
      // original ID stay available; a reconnect may safely retry both operations.
      const media = attachment ? await this.files.attach(message.conversationId, message.id, attachment.content, attachment.metadata) : null;
      return { message, media, duplicate:outcome.duplicate };
    } finally { if (attachment) this.activeFiles--; }
  }
}

@Injectable()
export class MessageReceiptsService {
  constructor(private readonly database: DataSource) {}
  async apply(input: MessageReceipt) {
    const value = { ...input };
    if (!isUUID(value.connectionId) || typeof value.remoteJid !== 'string' || !value.remoteJid || value.remoteJid.length > 255 ||
      typeof value.whatsappMessageId !== 'string' || !value.whatsappMessageId || value.whatsappMessageId.length > 255 ||
      typeof value.fromMe !== 'boolean' || !MESSAGE_STATES.includes(value.status)) throw new BadRequestException('Recibo invalido.');
    return this.database.transaction(async (manager) => {
      const conversation = await manager.getRepository(WhatsappConversation).findOne({
        where: { connectionId: value.connectionId, remoteJid: value.remoteJid }, lock: { mode: 'pessimistic_write' },
      });
      if (!conversation) return { matched: false, changed: false };
      const repository = manager.getRepository(WhatsappMessage);
      const message = await repository.findOneBy({ conversationId: conversation.id,
        whatsappMessageId: value.whatsappMessageId, fromMe: value.fromMe });
      if (!message) return { matched: false, changed: false };
      if (!value.fromMe) return { matched: true, changed: false, status: message.status,conversationId:conversation.id,messageId:message.id };
      if (!MESSAGE_STATES.includes(message.status as typeof MESSAGE_STATES[number]) || message.status === 'received' || value.status === 'received') throw new ConflictException('Estado legado ou recibo incompativel; mensagem preservada.');
      const rank: Record<string, number> = { pending: 0, failed: 0, sent: 1, delivered: 2, read: 3 };
      const changed = value.status === 'failed' ? ['pending', 'sent'].includes(message.status) : rank[value.status] > rank[message.status];
      if (changed) await repository.update(message.id, { status: value.status });
      return { matched: true, changed, status: changed ? value.status : message.status,conversationId:conversation.id,messageId:message.id };
    });
  }
}
