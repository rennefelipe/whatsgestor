import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { WhatsappConversationsService } from '../whatsapp-conversations/whatsapp-conversations.service';
import type { UserResponse } from '../users/users.service';
import { WhatsappSessionManagerService } from './baileys/whatsapp-session-manager.service';

function isIndividualJid(remoteJid: string): boolean {
  return /^[^@\s]+@(?:s\.whatsapp\.net|lid)$/.test(remoteJid);
}

@Injectable()
export class WhatsappMessageSendingService {
  private readonly logger = new Logger(WhatsappMessageSendingService.name);
  private readonly conversationsBeingSent = new Set<string>();

  constructor(
    private readonly conversations: WhatsappConversationsService,
    private readonly sessions: WhatsappSessionManagerService,
  ) {}

  async sendText(
    conversationId: string,
    user: UserResponse,
    textContent: string,
  ) {
    if (this.conversationsBeingSent.has(conversationId)) {
      throw new ConflictException(
        'Já existe um envio em andamento para esta conversa.',
      );
    }
    this.conversationsBeingSent.add(conversationId);

    try {
      const conversation = await this.conversations.findOne(conversationId);
      if (
        !user.isActive ||
        conversation.attendanceStatus !== 'in_progress' ||
        (!user.isAdmin &&
          conversation.assignedUserId?.toLowerCase() !== user.id.toLowerCase())
      )
        throw new ForbiddenException(
          'Inicie o atendimento e utilize o responsável ou um administrador para enviar mensagens.',
        );
      if (!isIndividualJid(conversation.remoteJid)) {
        throw new BadRequestException(
          'O envio está disponível somente para conversas individuais.',
        );
      }

      const sent = await this.sessions.sendText(
        conversation.connectionId,
        conversation.remoteJid,
        textContent,
      );
      try {
        return await this.conversations.persistMessage({
          connectionId: conversation.connectionId,
          remoteJid: conversation.remoteJid,
          contactName: conversation.contactName,
          whatsappMessageId: sent.whatsappMessageId,
          fromMe: true,
          messageType: 'text',
          textContent,
          messageTimestamp: sent.messageTimestamp ?? new Date(),
          status: 'sent',
        });
      } catch {
        this.logger.error('whatsapp_message_accepted_persistence_failed');
        throw new ServiceUnavailableException(
          'O WhatsApp aceitou a mensagem, mas ela não foi registrada. Verifique a conversa antes de tentar novamente.',
        );
      }
    } finally {
      this.conversationsBeingSent.delete(conversationId);
    }
  }
}
