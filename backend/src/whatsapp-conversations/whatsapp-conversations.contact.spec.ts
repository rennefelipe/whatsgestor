import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { Contact } from '../contacts/entities/contact.entity';
import { WhatsappConnection } from '../whatsapp-connections/entities/whatsapp-connection.entity';
import { WhatsappConversation } from './entities/whatsapp-conversation.entity';
import { WhatsappMessage } from './entities/whatsapp-message.entity';

jest.mock('@nestjs/typeorm', () => ({
  InjectRepository: () => () => undefined,
}));

import { WhatsappConversationsService } from './whatsapp-conversations.service';

const conversationId = 'bcf2e8e8-9fa4-4e56-a7e0-03f8d59ec170';
const contactId = '72098c86-0c7a-4af8-9756-6f7745d5e6e6';

function conversationQuery(results: Array<WhatsappConversation | null>) {
  return jest.fn(() => {
    const result = results.shift() ?? null;
    const builder = {
      leftJoin: jest.fn(),
      addSelect: jest.fn(),
      where: jest.fn(),
      getOne: jest.fn().mockResolvedValue(result),
    };
    builder.leftJoin.mockReturnValue(builder);
    builder.addSelect.mockReturnValue(builder);
    builder.where.mockReturnValue(builder);
    return builder;
  });
}

function createService(
  options: {
    query?: ReturnType<typeof conversationQuery>;
    findContact?: jest.Mock;
  } = {},
) {
  const updateConversation = jest.fn().mockResolvedValue({ affected: 1 });
  const findContact = options.findContact ?? jest.fn();
  const conversations = {
    createQueryBuilder: options.query ?? conversationQuery([]),
    update: updateConversation,
  } as unknown as Repository<WhatsappConversation>;
  const contacts = {
    findOneBy: findContact,
  } as unknown as Repository<Contact>;
  const service = new WhatsappConversationsService(
    {} as Repository<WhatsappConnection>,
    conversations,
    {} as Repository<WhatsappMessage>,
    contacts,
  );
  return { service, updateConversation, findContact };
}

describe('WhatsappConversationsService contact association', () => {
  it('links an existing active contact and returns its identifying fields', async () => {
    const linked = {
      id: conversationId,
      contactId,
      contact: { id: contactId, contactName: 'Contato cadastrado' },
    } as WhatsappConversation;
    const query = conversationQuery([
      { id: conversationId } as WhatsappConversation,
      linked,
    ]);
    const findContact = jest.fn().mockResolvedValue({
      id: contactId,
      contactName: 'Contato cadastrado',
      isActive: true,
    });
    const { service, updateConversation } = createService({
      query,
      findContact,
    });

    await expect(
      service.updateContact(conversationId, contactId),
    ).resolves.toBe(linked);

    expect(findContact).toHaveBeenCalledWith({
      id: contactId,
      isActive: true,
    });
    expect(updateConversation).toHaveBeenCalledWith(conversationId, {
      contactId,
    });
  });

  it('rejects a contact that does not exist or is inactive', async () => {
    const findContact = jest.fn().mockResolvedValue(null);
    const { service, updateConversation } = createService({
      query: conversationQuery([
        { id: conversationId } as WhatsappConversation,
      ]),
      findContact,
    });

    await expect(
      service.updateContact(conversationId, contactId),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(findContact).toHaveBeenCalledWith({
      id: contactId,
      isActive: true,
    });
    expect(updateConversation).not.toHaveBeenCalled();
  });

  it('rejects linking when the conversation does not exist', async () => {
    const findContact = jest.fn();
    const { service, updateConversation } = createService({
      query: conversationQuery([null]),
      findContact,
    });

    await expect(
      service.updateContact(conversationId, contactId),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(findContact).not.toHaveBeenCalled();
    expect(updateConversation).not.toHaveBeenCalled();
  });

  it('unlinks a conversation when contactId is null', async () => {
    const unlinked = {
      id: conversationId,
      contactId: null,
      contact: null,
    } as WhatsappConversation;
    const { service, updateConversation } = createService({
      query: conversationQuery([
        { id: conversationId, contactId } as WhatsappConversation,
        unlinked,
      ]),
    });

    await expect(service.updateContact(conversationId, null)).resolves.toBe(
      unlinked,
    );
    expect(updateConversation).toHaveBeenCalledWith(conversationId, {
      contactId: null,
    });
  });

  it('allows the same contact to be linked across separate WhatsApp connections', async () => {
    const secondConversationId = 'c11f55bd-91ee-44fc-99c2-47585e9aa58f';
    const { service, updateConversation } = createService({
      query: conversationQuery([
        {
          id: conversationId,
          connectionId: 'b0a36315-c991-4c83-bded-e450bbbc3494',
        } as WhatsappConversation,
        {
          id: conversationId,
          contactId,
        } as WhatsappConversation,
        {
          id: secondConversationId,
          connectionId: 'f2a32e44-0f6e-4ff8-a58c-4c82109a7c1f',
        } as WhatsappConversation,
        {
          id: secondConversationId,
          contactId,
        } as WhatsappConversation,
      ]),
      findContact: jest.fn().mockResolvedValue({
        id: contactId,
        isActive: true,
      }),
    });

    await service.updateContact(conversationId, contactId);
    await service.updateContact(secondConversationId, contactId);

    expect(updateConversation).toHaveBeenNthCalledWith(1, conversationId, {
      contactId,
    });
    expect(updateConversation).toHaveBeenNthCalledWith(
      2,
      secondConversationId,
      {
        contactId,
      },
    );
  });

  it('returns conversations without a linked contact', async () => {
    const unlinked = {
      id: conversationId,
      contactId: null,
      contact: null,
    } as WhatsappConversation;
    const { service } = createService({
      query: conversationQuery([unlinked]),
    });

    await expect(service.findOne(conversationId)).resolves.toBe(unlinked);
  });

  it('returns the linked contact with a conversation', async () => {
    const linked = {
      id: conversationId,
      contactId,
      contact: { id: contactId, contactName: 'Contato cadastrado' },
    } as WhatsappConversation;
    const { service } = createService({
      query: conversationQuery([linked]),
    });

    await expect(service.findOne(conversationId)).resolves.toBe(linked);
  });

  it('does not overwrite a manual association when a message updates conversation metadata', async () => {
    const linked = {
      id: conversationId,
      connectionId: 'b0a36315-c991-4c83-bded-e450bbbc3494',
      remoteJid: 'some-user@lid',
      contactId,
    } as WhatsappConversation;
    const updateValues: Array<Record<string, unknown>> = [];
    type MetadataBuilder = {
      update: () => MetadataBuilder;
      set: (values: Record<string, unknown>) => MetadataBuilder;
      where: () => MetadataBuilder;
      execute: () => Promise<void>;
    };
    const metadataBuilder = {} as MetadataBuilder;
    metadataBuilder.update = jest.fn((): MetadataBuilder => metadataBuilder);
    metadataBuilder.set = jest.fn(
      (values: Record<string, unknown>): MetadataBuilder => {
        updateValues.push(values);
        return metadataBuilder;
      },
    );
    metadataBuilder.where = jest.fn((): MetadataBuilder => metadataBuilder);
    metadataBuilder.execute = jest.fn().mockResolvedValue(undefined);
    const conversations = {
      findOneBy: jest.fn().mockResolvedValue(linked),
      createQueryBuilder: jest.fn().mockReturnValue(metadataBuilder),
    } as unknown as Repository<WhatsappConversation>;
    const connections = {
      findOneBy: jest.fn().mockResolvedValue({ id: linked.connectionId }),
    } as unknown as Repository<WhatsappConnection>;
    const messages = {
      findOneBy: jest.fn().mockResolvedValue({ id: 'existing-message' }),
    } as unknown as Repository<WhatsappMessage>;
    const service = new WhatsappConversationsService(
      connections,
      conversations,
      messages,
      {} as Repository<Contact>,
    );

    await service.persistMessage({
      connectionId: linked.connectionId,
      remoteJid: linked.remoteJid,
      contactName: 'Nome recebido pelo WhatsApp',
      whatsappMessageId: 'message-id',
      fromMe: false,
    });

    expect(updateValues).toEqual([
      { contactName: 'Nome recebido pelo WhatsApp' },
    ]);
    expect(updateValues[0]).not.toHaveProperty('contactId');
    for (const field of [
      'attendanceStatus',
      'assignedUserId',
      'attendanceStartedAt',
      'attendanceFinishedAt',
    ]) {
      expect(updateValues[0]).not.toHaveProperty(field);
    }
  });
});
