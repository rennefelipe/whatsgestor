import { Body, Controller, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { UserResponse } from '../users/users.service';
import { SendWhatsappTextDto } from './dto/send-whatsapp-text.dto';
import { WhatsappMessageSendingService } from './whatsapp-message-sending.service';

@Controller('whatsapp-conversations/:conversationId/messages')
export class WhatsappMessageSendingController {
  constructor(private readonly messages: WhatsappMessageSendingService) {}

  @Post()
  sendText(
    @Param('conversationId', new ParseUUIDPipe()) conversationId: string,
    @CurrentUser() user: UserResponse,
    @Body() dto: SendWhatsappTextDto,
  ) {
    return this.messages.sendText(conversationId, user, dto.textContent);
  }
}
