import { WhatsappMediaController } from './whatsapp-media.controller';
import { WhatsappMediaService } from './whatsapp-media.service';
import { WhatsappMessageMedia } from './entities/whatsapp-message-media.entity';
import { Module } from '@nestjs/common';
import { AdminGuard } from '../auth/guards/admin.guard';
import { User } from '../users/entities/user.entity';
import { WhatsappAttendanceService } from './whatsapp-attendance.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Contact } from '../contacts/entities/contact.entity';
import { WhatsappConnection } from '../whatsapp-connections/entities/whatsapp-connection.entity';
import { WhatsappConversation } from './entities/whatsapp-conversation.entity';
import { WhatsappMessage } from './entities/whatsapp-message.entity';
import { WhatsappConversationsController } from './whatsapp-conversations.controller';
import { WhatsappConversationsService } from './whatsapp-conversations.service';
import { BaileysIncomingMessageProcessor } from './baileys-incoming-message.processor';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Contact,
      User,
      WhatsappConnection,
      WhatsappConversation,
      WhatsappMessage,
      WhatsappMessageMedia,
    ]),
  ],
  controllers: [WhatsappConversationsController, WhatsappMediaController],
  providers: [
    WhatsappConversationsService,
    WhatsappMediaService,
    BaileysIncomingMessageProcessor,
    WhatsappAttendanceService,
    AdminGuard,
  ],
  exports: [BaileysIncomingMessageProcessor, WhatsappConversationsService],
})
export class WhatsappConversationsModule {}
