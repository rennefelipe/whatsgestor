import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { WhatsappConversationsService } from '../whatsapp-conversations/whatsapp-conversations.service';
import type { UserResponse } from '../users/users.service';
import { WhatsappSessionManagerService } from './baileys/whatsapp-session-manager.service';
import { WhatsappMessageSendingService } from './whatsapp-message-sending.service';

jest.mock('@nestjs/typeorm', () => ({
  InjectRepository: () => () => undefined,
}));
jest.mock('./baileys/whatsapp-session-manager.service', () => ({
  WhatsappSessionManagerService: class {},
}));

describe('WhatsappMessageSendingService', () => {
  const user = {
    id: '00000000-0000-4000-8000-000000000001',
    isActive: true,
    isAdmin: false,
  } as UserResponse;
  const conversation = {
    id: 'conversation-uuid',
    connectionId: 'connection-uuid',
    remoteJid: 'recipient@s.whatsapp.net',
    contactName: 'Synthetic contact',
    attendanceStatus: 'in_progress',
    assignedUserId: user.id,
  };
  let persistMessage: jest.Mock;
  let findOne: jest.Mock;
  let sendText: jest.Mock;
  let service: WhatsappMessageSendingService;

  beforeEach(() => {
    persistMessage = jest.fn().mockResolvedValue({ id: 'stored-message' });
    findOne = jest.fn().mockResolvedValue(conversation);
    sendText = jest.fn().mockResolvedValue({
      whatsappMessageId: 'baileys-message-id',
      messageTimestamp: new Date('2026-10-08T12:00:00Z'),
    });
    service = new WhatsappMessageSendingService(
      { findOne, persistMessage } as unknown as WhatsappConversationsService,
      { sendText } as unknown as WhatsappSessionManagerService,
    );
  });

  it('sends through the conversation connection and persists Baileys ID as an outgoing message', async () => {
    await expect(
      service.sendText(conversation.id, user, 'hello'),
    ).resolves.toEqual({ id: 'stored-message' });

    expect(sendText).toHaveBeenCalledWith(
      conversation.connectionId,
      conversation.remoteJid,
      'hello',
    );
    expect(persistMessage).toHaveBeenCalledWith({
      connectionId: conversation.connectionId,
      remoteJid: conversation.remoteJid,
      contactName: conversation.contactName,
      whatsappMessageId: 'baileys-message-id',
      fromMe: true,
      messageType: 'text',
      textContent: 'hello',
      messageTimestamp: new Date('2026-10-08T12:00:00Z'),
      status: 'sent',
    });
  });

  it('does not call Baileys for a missing conversation', async () => {
    findOne.mockRejectedValue(new NotFoundException());

    await expect(
      service.sendText(conversation.id, user, 'hello'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(sendText).not.toHaveBeenCalled();
  });

  it('does not persist when the connection is unavailable', async () => {
    sendText.mockRejectedValue(new ServiceUnavailableException());

    await expect(
      service.sendText(conversation.id, user, 'hello'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(persistMessage).not.toHaveBeenCalled();
  });

  it('does not persist or return success when Baileys rejects the send', async () => {
    sendText.mockRejectedValue(new BadGatewayException());

    await expect(
      service.sendText(conversation.id, user, 'hello'),
    ).rejects.toBeInstanceOf(BadGatewayException);
    expect(persistMessage).not.toHaveBeenCalled();
  });

  it('rejects sending to a non-individual JID', async () => {
    findOne.mockResolvedValue({
      ...conversation,
      remoteJid: 'group@g.us',
    });

    await expect(
      service.sendText(conversation.id, user, 'hello'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(sendText).not.toHaveBeenCalled();
  });

  it.each([
    [
      'a waiting attendance',
      { attendanceStatus: 'waiting', assignedUserId: null },
      user,
    ],
    [
      'a finished attendance',
      { attendanceStatus: 'finished', assignedUserId: user.id },
      user,
    ],
    [
      'another responsible user',
      {
        attendanceStatus: 'in_progress',
        assignedUserId: '00000000-0000-4000-8000-000000000002',
      },
      user,
    ],
    [
      'an inactive user',
      { attendanceStatus: 'in_progress', assignedUserId: user.id },
      { ...user, isActive: false },
    ],
  ])('rejects %s before calling Baileys', async (_label, fields, actor) => {
    findOne.mockResolvedValue({ ...conversation, ...fields });
    await expect(
      service.sendText(conversation.id, actor, 'hello'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(sendText).not.toHaveBeenCalled();
    expect(persistMessage).not.toHaveBeenCalled();
  });

  it('allows an active administrator on another user attendance', async () => {
    findOne.mockResolvedValue({
      ...conversation,
      assignedUserId: '00000000-0000-4000-8000-000000000002',
    });
    await expect(
      service.sendText(conversation.id, { ...user, isAdmin: true }, 'hello'),
    ).resolves.toEqual({ id: 'stored-message' });
    expect(sendText).toHaveBeenCalledTimes(1);
  });

  it('does not retry the Baileys send if persistence fails after acceptance', async () => {
    persistMessage.mockRejectedValue(new Error('synthetic database failure'));

    await expect(
      service.sendText(conversation.id, user, 'hello'),
    ).rejects.toThrow(/aceitou a mensagem.*Verifique a conversa/);

    expect(sendText).toHaveBeenCalledTimes(1);
    expect(persistMessage).toHaveBeenCalledTimes(1);
  });

  it('rejects a concurrent send for the same conversation', async () => {
    let resolveSend: (value: {
      whatsappMessageId: string;
      messageTimestamp: Date;
    }) => void = () => undefined;
    sendText.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSend = resolve;
        }),
    );

    const pendingSend = service.sendText(conversation.id, user, 'first');
    await Promise.resolve();
    await expect(
      service.sendText(conversation.id, user, 'second'),
    ).rejects.toBeInstanceOf(ConflictException);
    resolveSend({
      whatsappMessageId: 'baileys-message-id',
      messageTimestamp: new Date(),
    });
    await expect(pendingSend).resolves.toEqual({ id: 'stored-message' });
    expect(sendText).toHaveBeenCalledTimes(1);
  });
});
