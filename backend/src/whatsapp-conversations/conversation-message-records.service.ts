import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { DomainEvents } from '../events/domain-events';
import { isUUID } from 'class-validator';
import { DataSource } from 'typeorm';
import { WhatsappConversation } from './entities/whatsapp-conversation.entity';
import { WhatsappMessage } from './entities/whatsapp-message.entity';
import type { ConversationMessageRecords, MessageRecordInput } from './message-record.port';

function sqlCode(error: unknown): number | undefined {
  const candidate = error as { driverError?: { number?: number }; number?: number } | null;
  return candidate?.driverError?.number ?? candidate?.number;
}

@Injectable()
export class ConversationMessageRecordsService implements ConversationMessageRecords {
  constructor(private readonly database: DataSource, @Optional() private readonly events?: DomainEvents) {}

  async record(input: MessageRecordInput): Promise<WhatsappMessage> {
    return (await this.recordWithOutcome(input)).message;
  }
  async recordWithOutcome(input: MessageRecordInput): Promise<{message:WhatsappMessage;duplicate:boolean}> {
    this.validate(input);
    // Own the identity and timestamp across awaits/retries; adapters may reuse
    // their event object after dispatching a reconnect batch.
    input = { ...input, messageTimestamp: input.messageTimestamp ? new Date(input.messageTimestamp) : input.messageTimestamp };
    for (let attempt = 0; ; attempt++) {
      try {
        const result = await this.recordOnce(input);
        if (!result.duplicate && result.waitingEvent) this.events?.emit({ type: 'attendance.changed',
          automaticEvent: 'waiting', connectionId: input.connectionId, conversationId: result.message.conversationId,
          transitionKey: `waiting:${result.message.id}` });
        return { message: result.message, duplicate: result.duplicate };
      }
      catch (error) {
        // Retry the entire rolled-back transaction using the same immutable message key.
        if (attempt >= 2 || ![2601, 2627, 1205].includes(sqlCode(error) ?? -1)) throw error;
      }
    }
  }

  private async recordOnce(input: MessageRecordInput): Promise<{message:WhatsappMessage;duplicate:boolean;waitingEvent?:boolean}> {
    return this.database.transaction('SERIALIZABLE', async (manager) => {
      const connection = await manager.createQueryBuilder().select('connection.id', 'id')
        .from('dbo.whatsapp_connections', 'connection')
        .where('connection.id = :connectionId', { connectionId: input.connectionId }).getRawOne();
      if (!connection) throw new NotFoundException('Conexão WhatsApp não encontrada.');
      const conversations = manager.getRepository(WhatsappConversation);
      const messages = manager.getRepository(WhatsappMessage);
      const key = { connectionId: input.connectionId, remoteJid: input.remoteJid };
      let conversation = await conversations.findOne({ where: key, lock: { mode: 'pessimistic_write' } });
      const newConversation = !conversation;
      if (!conversation) conversation = await conversations.save(conversations.create({ ...key, contactName: input.contactName ?? null }));
      const messageKey = { conversationId: conversation.id, whatsappMessageId: input.whatsappMessageId, fromMe: input.fromMe };
      const existing = await messages.findOneBy(messageKey);
      if (existing) return {message:existing,duplicate:true};
      const message = await messages.save(messages.create({
        ...messageKey,
        messageType: input.messageType ?? 'text', textContent: input.textContent ?? null,
        messageTimestamp: input.messageTimestamp ?? null,
        status: input.status ?? (input.fromMe ? 'sent' : 'received'),
      }));
      const timestamp = message.messageTimestamp?.getTime();
      const finished = conversation.attendanceFinishedAt?.getTime();
      const reopen = input.origin === 'live' && !input.fromMe &&
        /^[^@\s]+@(?:s\.whatsapp\.net|lid|hosted|hosted\.lid)$/.test(input.remoteJid) &&
        conversation.attendanceStatus === 'finished' && timestamp !== undefined && finished !== undefined && timestamp > finished;
      const changes = {
        ...(input.contactName !== undefined && (conversation.contactName===null || timestamp!==undefined &&
          (conversation.lastMessageAt===null||timestamp>=conversation.lastMessageAt.getTime())) ? { contactName: input.contactName } : {}),
        ...(timestamp !== undefined && (conversation.lastMessageAt === null || conversation.lastMessageAt.getTime() < timestamp)
          ? { lastMessageAt: message.messageTimestamp } : {}),
        ...(reopen ? { attendanceStatus: 'waiting' as const, assignedUserId: null } : {}),
      };
      if (Object.keys(changes).length) await conversations.update(conversation.id, changes);
      const directLive = input.origin === 'live' && !input.fromMe && /^[^@\s]+@(?:s\.whatsapp\.net|lid|hosted|hosted\.lid)$/.test(input.remoteJid);
      return {message,duplicate:false,waitingEvent:directLive && (newConversation || reopen)};
    });
  }

  private validate(input: MessageRecordInput): void {
    const text = (value: unknown, limit: number) => typeof value === 'string' && value.trim().length > 0 && value.length <= limit;
    if (!isUUID(input.connectionId) || !text(input.remoteJid, 255) || !text(input.whatsappMessageId, 255) ||
      typeof input.fromMe !== 'boolean' || !['live', 'history', 'outgoing'].includes(input.origin) ||
      (input.origin === 'outgoing' && !input.fromMe) ||
      (input.contactName != null && (typeof input.contactName !== 'string' || input.contactName.length > 255)) ||
      (input.messageType !== undefined && !text(input.messageType, 50)) ||
      (input.status !== undefined && !text(input.status, 30)) ||
      (input.textContent != null && typeof input.textContent !== 'string') ||
      (input.messageTimestamp != null && (!(input.messageTimestamp instanceof Date) || !Number.isFinite(input.messageTimestamp.getTime())))) {
      throw new BadRequestException('Registro de mensagem inválido.');
    }
  }
}
