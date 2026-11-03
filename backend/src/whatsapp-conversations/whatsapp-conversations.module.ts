import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminGuard } from '../auth/guards/admin.guard';
import { Contact } from '../contacts/entities/contact.entity';
import { User } from '../users/entities/user.entity';
import { UsersModule } from '../users/users.module';
import { WhatsappConversation } from './entities/whatsapp-conversation.entity';
import { WhatsappMessage } from './entities/whatsapp-message.entity';
import { WhatsappMessageMedia } from './entities/whatsapp-message-media.entity';
import { ConversationMessageRecordsService } from './conversation-message-records.service';
import { CONVERSATION_MESSAGE_RECORDS } from './message-record.port';
import { WhatsappAttendanceService } from './whatsapp-attendance.service';
import { WhatsappConversationsController } from './whatsapp-conversations.controller';
import { WhatsappConversationsService } from './whatsapp-conversations.service';

@Module({
  imports: [UsersModule, TypeOrmModule.forFeature([WhatsappConversation, WhatsappMessage, WhatsappMessageMedia, Contact, User])],
  controllers: [WhatsappConversationsController],
  providers: [WhatsappConversationsService, WhatsappAttendanceService, AdminGuard,
    ConversationMessageRecordsService,
    { provide: CONVERSATION_MESSAGE_RECORDS, useExisting: ConversationMessageRecordsService }],
  exports: [WhatsappConversationsService, CONVERSATION_MESSAGE_RECORDS],
})
export class WhatsappConversationsModule {}
