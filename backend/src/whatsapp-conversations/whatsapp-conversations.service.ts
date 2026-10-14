import { whatsappMediaEnabled } from './media-feature';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { conversationQuery } from './conversation-query';
import { Contact } from '../contacts/entities/contact.entity';
import { WhatsappConnection } from '../whatsapp-connections/entities/whatsapp-connection.entity';
import { FindWhatsappConversationsQueryDto } from './dto/find-whatsapp-conversations-query.dto';
import { FindWhatsappMessagesQueryDto } from './dto/find-whatsapp-messages-query.dto';
import { WhatsappConversation } from './entities/whatsapp-conversation.entity';
import { WhatsappMessage } from './entities/whatsapp-message.entity';
import { WhatsappMessageMedia } from './entities/whatsapp-message-media.entity';
import type { OutboundRecord } from '../whatsapp-connections/outbound-media-journal';

export interface PersistWhatsappMessageInput {
  connectionId: string;
  remoteJid: string;
  contactName?: string | null;
  whatsappMessageId: string;
  fromMe: boolean;
  messageType?: string;
  textContent?: string | null;
  messageTimestamp?: Date | null;
  status?: string;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

function isUniqueConstraintViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const driverError =
    'driverError' in error &&
    typeof error.driverError === 'object' &&
    error.driverError !== null
      ? error.driverError
      : error;
  if (!('number' in driverError)) return false;
  return driverError.number === 2601 || driverError.number === 2627;
}

@Injectable()
export class WhatsappConversationsService {
  constructor(
    @InjectRepository(WhatsappConnection)
    private readonly connections: Repository<WhatsappConnection>,
    @InjectRepository(WhatsappConversation)
    private readonly conversations: Repository<WhatsappConversation>,
    @InjectRepository(WhatsappMessage)
    private readonly messages: Repository<WhatsappMessage>,
    @InjectRepository(Contact)
    private readonly contacts: Repository<Contact>,
  ) {}

  async findAll(
    query: FindWhatsappConversationsQueryDto,
  ): Promise<PaginatedResult<WhatsappConversation>> {
    const builder = conversationQuery(this.conversations);
    if (query.connectionId) {
      builder.andWhere('conversation.connectionId = :connectionId', {
        connectionId: query.connectionId,
      });
    }

    // SQL Server sorts NULL dates last in descending order.
    const [items, total] = await builder
      .orderBy('conversation.lastMessageAt', 'DESC')
      .addOrderBy('conversation.createdAt', 'DESC')
      .addOrderBy('conversation.id', 'ASC')
      .skip((query.page - 1) * query.pageSize)
      .take(query.pageSize)
      .getManyAndCount();

    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  async findOne(id: string): Promise<WhatsappConversation> {
    const conversation = await conversationQuery(this.conversations)
      .where('conversation.id = :id', { id })
      .getOne();
    if (!conversation) {
      throw new NotFoundException('Conversa WhatsApp não encontrada.');
    }
    return conversation;
  }

  async updateContact(
    id: string,
    contactId: string | null,
  ): Promise<WhatsappConversation> {
    await this.findOne(id);

    if (contactId !== null) {
      const contact = await this.contacts.findOneBy({
        id: contactId,
        isActive: true,
      });
      if (!contact) {
        throw new BadRequestException(
          'O contato informado não existe ou está inativo.',
        );
      }
    }

    await this.conversations.update(id, { contactId });
    return this.findOne(id);
  }

  async findMessages(
    conversationId: string,
    query: FindWhatsappMessagesQueryDto,
  ): Promise<PaginatedResult<WhatsappMessage>> {
    await this.findOne(conversationId);
    const builder = this.messages.createQueryBuilder('message');
    if (whatsappMediaEnabled())
      builder.leftJoinAndSelect('message.media', 'media');
    const [items, total] = await builder
      .where('message.conversationId = :conversationId', { conversationId })
      .addSelect(
        'CASE WHEN message.messageTimestamp IS NULL THEN 1 ELSE 0 END',
        'message_timestamp_missing',
      )
      .orderBy('message_timestamp_missing', 'ASC')
      .addOrderBy('message.messageTimestamp', 'ASC')
      .addOrderBy('message.createdAt', 'ASC')
      .addOrderBy('message.id', 'ASC')
      .skip((query.page - 1) * query.pageSize)
      .take(query.pageSize)
      .getManyAndCount();

    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  async persistMessage(
    input: PersistWhatsappMessageInput,
    options: { allowAutomaticReopen?: boolean } = {},
  ): Promise<WhatsappMessage> {
    const connection = await this.connections.findOneBy({
      id: input.connectionId,
    });
    if (!connection) {
      throw new NotFoundException('Conexão WhatsApp não encontrada.');
    }

    const conversation = await this.findOrCreateConversation(input);
    if (
      options.allowAutomaticReopen === true &&
      input.fromMe === false &&
      /^[^@\s]+@(?:s\.whatsapp\.net|lid)$/.test(input.remoteJid)
    ) {
      return this.persistLiveIncomingMessage(conversation.id, input);
    }
    const messageKey = {
      conversationId: conversation.id,
      whatsappMessageId: input.whatsappMessageId,
      fromMe: input.fromMe,
    };
    let message = await this.messages.findOneBy(messageKey);

    if (!message) {
      message = this.messages.create({
        ...messageKey,
        messageType: input.messageType ?? 'text',
        textContent: input.textContent ?? null,
        messageTimestamp: input.messageTimestamp ?? null,
        status: input.status ?? (input.fromMe ? 'sent' : 'received'),
      });
      try {
        message = await this.messages.save(message);
      } catch (error) {
        if (!isUniqueConstraintViolation(error)) throw error;
        const existingMessage = await this.messages.findOneBy(messageKey);
        if (!existingMessage) throw error;
        message = existingMessage;
      }
    }

    await this.updateConversationMetadata(conversation.id, input);
    return message;
  }

  async findMessage(
    conversationId: string,
    id: string,
  ): Promise<WhatsappMessage> {
    const message = await this.messages.findOne({
      where: { id, conversationId },
      relations: { media: true },
    });
    if (!message)
      throw new NotFoundException('Mensagem não encontrada nesta conversa.');
    return message;
  }

  async persistConfirmedAttachment(
    record: OutboundRecord,
  ): Promise<WhatsappMessage> {
    if (!record.whatsappMessageId || !record.timestamp)
      throw new BadRequestException('Envio sem confirmação.');
    return this.conversations.manager.transaction(async (manager) => {
      const conversations = manager.getRepository(WhatsappConversation);
      const conversation = await conversations.findOne({
        where: { id: record.conversationId },
        lock: { mode: 'pessimistic_write' },
      });
      if (
        !conversation ||
        conversation.connectionId !== record.connectionId ||
        conversation.remoteJid !== record.remoteJid
      )
        throw new NotFoundException('Conversa original do envio indisponível.');
      const messages = manager.getRepository(WhatsappMessage),
        media = manager.getRepository(WhatsappMessageMedia);
      const key = {
        conversationId: record.conversationId,
        whatsappMessageId: record.whatsappMessageId,
        fromMe: true,
      };
      let message = await messages.findOneBy(key);
      if (!message)
        message = await messages.save(
          messages.create({
            ...key,
            messageType: record.metadata.kind,
            textContent: null,
            messageTimestamp: new Date(record.timestamp!),
            status: 'sent',
          }),
        );
      const existing = await media.findOneBy({ messageId: message.id });
      if (!existing)
        await media.save(
          media.create({
            messageId: message.id,
            kind: record.metadata.kind,
            mimeType: record.metadata.mimeType,
            originalName: record.metadata.originalName,
            sizeBytes: record.metadata.size,
            durationSeconds:
              record.metadata.kind === 'audio'
                ? record.metadata.durationSeconds
                : null,
            storageKey: record.storageKey,
            availability: 'ready',
          }),
        );
      await this.updateConversationMetadata(
        record.conversationId,
        {
          connectionId: record.connectionId,
          remoteJid: record.remoteJid,
          whatsappMessageId: record.whatsappMessageId!,
          fromMe: true,
          messageTimestamp: new Date(record.timestamp!),
        },
        conversations,
      );
      // Default entity projection excludes the private storage key.
      return messages.findOneOrFail({
        where: { id: message.id },
        relations: { media: true },
      });
    });
  }

  private async persistLiveIncomingMessage(
    conversationId: string,
    input: PersistWhatsappMessageInput,
  ): Promise<WhatsappMessage> {
    const messageKey = {
      conversationId,
      whatsappMessageId: input.whatsappMessageId,
      fromMe: false,
    };
    try {
      return await this.conversations.manager.transaction(async (manager) => {
        const conversations = manager.getRepository(WhatsappConversation);
        const messages = manager.getRepository(WhatsappMessage);
        // Uses the same SQL Server UPDLOCK as manual attendance transitions.
        const conversation = await conversations.findOne({
          where: { id: conversationId },
          select: {
            id: true,
            attendanceStatus: true,
            attendanceFinishedAt: true,
          },
          lock: { mode: 'pessimistic_write' },
        });
        if (!conversation) {
          throw new NotFoundException('Conversa WhatsApp não encontrada.');
        }

        let message = await messages.findOneBy(messageKey);
        const isNew = message === null;
        if (!message) {
          message = await messages.save(
            messages.create({
              ...messageKey,
              messageType: input.messageType ?? 'text',
              textContent: input.textContent ?? null,
              messageTimestamp: input.messageTimestamp ?? null,
              status: input.status ?? 'received',
            }),
          );
        }
        await this.updateConversationMetadata(
          conversationId,
          input,
          conversations,
        );

        const messageTimestamp = message.messageTimestamp?.getTime();
        const finishedAt = conversation.attendanceFinishedAt?.getTime();
        if (
          isNew &&
          conversation.attendanceStatus === 'finished' &&
          messageTimestamp !== undefined &&
          finishedAt !== undefined &&
          Number.isFinite(messageTimestamp) &&
          Number.isFinite(finishedAt) &&
          messageTimestamp > finishedAt
        ) {
          // Match manual reopen: release the assignee without clearing past timestamps.
          await conversations.update(conversationId, {
            attendanceStatus: 'waiting',
            assignedUserId: null,
          });
        }
        return message;
      });
    } catch (error) {
      // Recover only after rollback; a duplicate insert never triggers reopening.
      if (!isUniqueConstraintViolation(error)) throw error;
      const existing = await this.messages.findOneBy(messageKey);
      if (!existing) throw error;
      await this.updateConversationMetadata(conversationId, input);
      return existing;
    }
  }

  private async findOrCreateConversation(
    input: PersistWhatsappMessageInput,
  ): Promise<WhatsappConversation> {
    const key = {
      connectionId: input.connectionId,
      remoteJid: input.remoteJid,
    };
    const existing = await this.conversations.findOneBy(key);
    if (existing) return existing;

    const conversation = this.conversations.create({
      ...key,
      contactName: input.contactName ?? null,
    });
    try {
      return await this.conversations.save(conversation);
    } catch (error) {
      if (!isUniqueConstraintViolation(error)) throw error;
      const concurrentConversation = await this.conversations.findOneBy(key);
      if (!concurrentConversation) throw error;
      return concurrentConversation;
    }
  }

  private async updateConversationMetadata(
    conversationId: string,
    input: PersistWhatsappMessageInput,
    repository: Repository<WhatsappConversation> = this.conversations,
  ): Promise<void> {
    const changes = {
      ...(input.contactName !== undefined
        ? { contactName: input.contactName }
        : {}),
      ...(input.messageTimestamp
        ? {
            lastMessageAt: () =>
              'CASE WHEN [lastMessageAt] IS NULL OR [lastMessageAt] < :messageTimestamp THEN :messageTimestamp ELSE [lastMessageAt] END',
          }
        : {}),
    };
    if (!Object.keys(changes).length) return;

    const builder = repository
      .createQueryBuilder()
      .update(WhatsappConversation)
      .set(changes)
      .where('id = :conversationId', { conversationId });
    if (input.messageTimestamp) {
      builder.setParameter('messageTimestamp', input.messageTimestamp);
    }
    await builder.execute();
  }
}
