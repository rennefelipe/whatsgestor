import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, DataSource, Repository } from 'typeorm';
import { Contact } from '../contacts/entities/contact.entity';
import { conversationQuery } from './conversation-query';
import { FindWhatsappConversationsQueryDto } from './dto/find-whatsapp-conversations-query.dto';
import { FindWhatsappMessagesQueryDto } from './dto/find-whatsapp-messages-query.dto';
import { WhatsappConversation } from './entities/whatsapp-conversation.entity';
import { WhatsappMessage } from './entities/whatsapp-message.entity';

function escapeLike(value: string): string {
  return value.replace(/~/g, '~~').replace(/%/g, '~%').replace(/_/g, '~_').replace(/\[/g, '~[');
}

@Injectable()
export class WhatsappConversationsService {
  constructor(
    @InjectRepository(WhatsappConversation) private readonly conversations: Repository<WhatsappConversation>,
    @InjectRepository(WhatsappMessage) private readonly messages: Repository<WhatsappMessage>,
    private readonly database: DataSource,
  ) {}

  async findAll(query: FindWhatsappConversationsQueryDto) {
    const builder = conversationQuery(this.conversations);
    for (const key of ['connectionId', 'attendanceStatus', 'assignedUserId', 'contactId'] as const) {
      if (query[key] !== undefined) builder.andWhere(`conversation.${key} = :${key}`, { [key]: query[key] });
    }
    if (query.search?.trim()) {
      builder.andWhere(new Brackets((search) => {
        search.where("conversation.contactName LIKE :search ESCAPE '~'")
          .orWhere("conversation.remoteJid LIKE :search ESCAPE '~'")
          .orWhere("contact.contactName LIKE :search ESCAPE '~'")
          .orWhere("assignedUser.username LIKE :search ESCAPE '~'");
      }), { search: `%${escapeLike(query.search.trim())}%` });
    }
    const [items, total] = await builder.orderBy('conversation.lastMessageAt', 'DESC')
      .addOrderBy('conversation.createdAt', 'DESC').addOrderBy('conversation.id', 'ASC')
      .skip((query.page - 1) * query.pageSize).take(query.pageSize).getManyAndCount();
    // One bounded query for the current page, never a query per conversation.
    const latest=items.length?await this.messages.createQueryBuilder('message')
      .select(['message.id','message.conversationId','message.messageType','message.textContent','message.fromMe','message.messageTimestamp','message.createdAt'])
      .where('message.conversationId IN (:...conversationIds)',{conversationIds:items.map(item=>item.id)})
      .andWhere(`message.id = (SELECT TOP(1) latest.id FROM dbo.whatsapp_messages latest
        WHERE latest.conversationId = message.conversationId
        ORDER BY COALESCE(latest.messageTimestamp, latest.createdAt) DESC, latest.createdAt DESC, latest.id DESC)`).getMany():[];
    const byConversation=new Map(latest.map(message=>[message.conversationId,message]));
    return { items:items.map(item=>({...item,lastMessage:byConversation.get(item.id)??null})), total, page: query.page, pageSize: query.pageSize };
  }

  async findOne(id: string): Promise<WhatsappConversation> {
    const result = await conversationQuery(this.conversations).where('conversation.id = :id', { id }).getOne();
    if (!result) throw new NotFoundException('Conversa WhatsApp não encontrada.');
    return result;
  }

  async findMessages(conversationId: string, query: FindWhatsappMessagesQueryDto) {
    await this.findOne(conversationId);
    const [items, total] = await this.messages.createQueryBuilder('message')
      .leftJoin('message.media', 'media')
      .addSelect(['media.id', 'media.kind', 'media.availability', 'media.mimeType',
        'media.originalName', 'media.sizeBytes', 'media.durationSeconds'])
      .where('message.conversationId = :conversationId', { conversationId })
      .addSelect('CASE WHEN message.messageTimestamp IS NULL THEN 1 ELSE 0 END', 'message_timestamp_missing')
      .orderBy('message_timestamp_missing', 'ASC').addOrderBy('message.messageTimestamp', 'ASC')
      .addOrderBy('message.createdAt', 'ASC').addOrderBy('message.id', 'ASC')
      .skip((query.page - 1) * query.pageSize).take(query.pageSize).getManyAndCount();
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  async updateContact(id: string, contactId: string | null): Promise<WhatsappConversation> {
    await this.findOne(id);
    return this.database.transaction(async (manager) => {
      // Read the contact before taking the conversation lock, consistent with FK deletion order.
      if (contactId !== null) {
        const contact = await manager.getRepository(Contact).findOne({
          where: { id: contactId, isActive: true }, select: { id: true }, lock: { mode: 'pessimistic_read' },
        });
        if (!contact) throw new BadRequestException('O contato informado não existe ou está inativo.');
      }
      const repository = manager.getRepository(WhatsappConversation);
      const conversation = await repository.findOne({ where: { id }, select: { id: true }, lock: { mode: 'pessimistic_write' } });
      if (!conversation) throw new NotFoundException('Conversa WhatsApp não encontrada.');
      await repository.update(id, { contactId });
      const result = await conversationQuery(repository).where('conversation.id = :id', { id }).getOne();
      if (!result) throw new NotFoundException('Conversa WhatsApp não encontrada.');
      return result;
    });
  }
}
