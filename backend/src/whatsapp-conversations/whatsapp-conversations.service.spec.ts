import { Repository } from 'typeorm';
import { Contact } from '../contacts/entities/contact.entity';
import { WhatsappConnection } from '../whatsapp-connections/entities/whatsapp-connection.entity';
import { WhatsappConversation } from './entities/whatsapp-conversation.entity';
import { WhatsappMessage } from './entities/whatsapp-message.entity';

jest.mock('@nestjs/typeorm', () => ({
  InjectRepository: () => () => undefined,
}));

import { WhatsappConversationsService } from './whatsapp-conversations.service';

describe('WhatsappConversationsService', () => {
  it('returns an existing message when the same Baileys event is processed again', async () => {
    const connection = { id: 'connection-id' } as WhatsappConnection;
    const conversation = {
      id: 'conversation-id',
      connectionId: connection.id,
      remoteJid: 'remote-jid',
    } as WhatsappConversation;
    const message = {
      id: 'message-id',
      conversationId: conversation.id,
      whatsappMessageId: 'baileys-message-id',
      fromMe: false,
    } as WhatsappMessage;

    const connections = {
      findOneBy: jest.fn().mockResolvedValue(connection),
    } as unknown as Repository<WhatsappConnection>;
    const conversations = {
      findOneBy: jest.fn().mockResolvedValue(conversation),
    } as unknown as Repository<WhatsappConversation>;
    const findMessage = jest.fn().mockResolvedValue(message);
    const createMessage = jest.fn();
    const saveMessage = jest.fn();
    const messages = {
      findOneBy: findMessage,
      create: createMessage,
      save: saveMessage,
    } as unknown as Repository<WhatsappMessage>;
    const service = new WhatsappConversationsService(
      connections,
      conversations,
      messages,
      {} as Repository<Contact>,
    );
    const event = {
      connectionId: connection.id,
      remoteJid: conversation.remoteJid,
      whatsappMessageId: message.whatsappMessageId,
      fromMe: message.fromMe,
    };

    await expect(service.persistMessage(event)).resolves.toBe(message);
    await expect(service.persistMessage(event)).resolves.toBe(message);

    expect(findMessage).toHaveBeenCalledTimes(2);
    expect(createMessage).not.toHaveBeenCalled();
    expect(saveMessage).not.toHaveBeenCalled();
  });

  it('returns the message after a concurrent insert violates the unique index', async () => {
    const connection = { id: 'connection-id' } as WhatsappConnection;
    const conversation = {
      id: 'conversation-id',
      connectionId: connection.id,
      remoteJid: 'remote-jid',
    } as WhatsappConversation;
    const message = {
      id: 'message-id',
      conversationId: conversation.id,
      whatsappMessageId: 'baileys-message-id',
      fromMe: false,
    } as WhatsappMessage;
    const connections = {
      findOneBy: jest.fn().mockResolvedValue(connection),
    } as unknown as Repository<WhatsappConnection>;
    const conversations = {
      findOneBy: jest.fn().mockResolvedValue(conversation),
    } as unknown as Repository<WhatsappConversation>;
    const findMessage = jest
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(message);
    const createMessage = jest.fn().mockReturnValue({ ...message });
    const saveMessage = jest
      .fn()
      .mockRejectedValue({ driverError: { number: 2627 } });
    const messages = {
      findOneBy: findMessage,
      create: createMessage,
      save: saveMessage,
    } as unknown as Repository<WhatsappMessage>;
    const service = new WhatsappConversationsService(
      connections,
      conversations,
      messages,
      {} as Repository<Contact>,
    );

    await expect(
      service.persistMessage({
        connectionId: connection.id,
        remoteJid: conversation.remoteJid,
        whatsappMessageId: message.whatsappMessageId,
        fromMe: message.fromMe,
      }),
    ).resolves.toBe(message);
    expect(findMessage).toHaveBeenCalledTimes(2);
  });
  it('orders all conversations deterministically before paginating and retains the connection filter', async () => {
    const result = [{ id: 'conversation', attendanceStatus: 'waiting' }];
    const builder = {
      leftJoin: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([result, 3]),
    };
    const repository = {
      createQueryBuilder: jest.fn().mockReturnValue(builder),
    } as unknown as Repository<WhatsappConversation>;
    const service = new WhatsappConversationsService(
      {} as Repository<WhatsappConnection>,
      repository,
      {} as Repository<WhatsappMessage>,
      {} as Repository<Contact>,
    );
    await expect(
      service.findAll({ connectionId: 'connection', page: 2, pageSize: 1 }),
    ).resolves.toEqual({ items: result, total: 3, page: 2, pageSize: 1 });
    expect(builder.andWhere).toHaveBeenCalledWith(
      'conversation.connectionId = :connectionId',
      { connectionId: 'connection' },
    );
    expect(builder.orderBy).toHaveBeenCalledWith(
      'conversation.lastMessageAt',
      'DESC',
    );
    expect(builder.addOrderBy.mock.calls).toEqual([
      ['conversation.createdAt', 'DESC'],
      ['conversation.id', 'ASC'],
    ]);
    expect(builder.skip).toHaveBeenCalledWith(1);
    expect(builder.take).toHaveBeenCalledWith(1);
    expect(builder.addOrderBy.mock.invocationCallOrder[1]).toBeLessThan(
      builder.skip.mock.invocationCallOrder[0],
    );
    expect(builder.take.mock.invocationCallOrder[0]).toBeLessThan(
      builder.getManyAndCount.mock.invocationCallOrder[0],
    );
  });
});
