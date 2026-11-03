import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { WhatsappConversationsModule } from '../whatsapp-conversations/whatsapp-conversations.module';
import { FilePolicy } from './file-policy';
import { PrivateFileStorage } from './private-file-storage';
import { MessageFilesService } from './message-files.service';
import { MessagesService, MessageReceiptsService } from './messages.service';
import { MessagesController, FileUploadGuard,SendEnabledGuard } from './messages.controller';
import { MESSAGE_INGRESS, MESSAGE_RECEIPTS } from './message-provider.port';
import { OutboundRouter } from './outbound-router';

@Module({
  imports: [WhatsappConversationsModule, MulterModule.registerAsync({ inject: [ConfigService], useFactory: (config: ConfigService) => {
    const policy = new FilePolicy(config);
    return { limits: { fileSize: policy.maxBytes, files: 1, fields: 0, parts: 1, headerPairs: 50 }, defParamCharset: 'utf8' };
  } })],
  controllers: [MessagesController],
  providers: [OutboundRouter,SendEnabledGuard, FilePolicy, PrivateFileStorage, MessageFilesService, MessagesService, MessageReceiptsService, FileUploadGuard,
    { provide: MESSAGE_INGRESS, useExisting: MessagesService }, { provide: MESSAGE_RECEIPTS, useExisting: MessageReceiptsService }],
  exports: [OutboundRouter,MessagesService,MessageReceiptsService,FilePolicy,PrivateFileStorage,MESSAGE_INGRESS, MESSAGE_RECEIPTS, MessageFilesService],
})
export class MessagesModule {}
