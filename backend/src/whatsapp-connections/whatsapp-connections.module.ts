import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminGuard } from '../auth/guards/admin.guard';
import { WhatsappConversationsModule } from '../whatsapp-conversations/whatsapp-conversations.module';
import { WhatsappConnection } from './entities/whatsapp-connection.entity';
import { WhatsappConnectionsController } from './whatsapp-connections.controller';
import { WhatsappMessageSendingController } from './whatsapp-message-sending.controller';
import { WhatsappMessageSendingService } from './whatsapp-message-sending.service';
import { WhatsappAttachmentSendingService } from './whatsapp-attachment-sending.service';
import {
  WhatsappAttachmentSendingController,
  WhatsappAudioSendingController,
  AttachmentUploadGuard,
} from './whatsapp-attachment-sending.controller';
import { WhatsappConnectionsService } from './whatsapp-connections.service';
import { WhatsappSessionManagerService } from './baileys/whatsapp-session-manager.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([WhatsappConnection]),
    WhatsappConversationsModule,
  ],
  controllers: [
    WhatsappConnectionsController,
    WhatsappMessageSendingController,
    WhatsappAttachmentSendingController,
    WhatsappAudioSendingController,
  ],
  providers: [
    WhatsappConnectionsService,
    WhatsappMessageSendingService,
    WhatsappAttachmentSendingService,
    AttachmentUploadGuard,
    WhatsappSessionManagerService,
    AdminGuard,
  ],
  exports: [WhatsappSessionManagerService],
})
export class WhatsappConnectionsModule {}
