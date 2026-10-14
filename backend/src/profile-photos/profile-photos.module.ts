import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Contact } from '../contacts/entities/contact.entity';
import { WhatsappConversation } from '../whatsapp-conversations/entities/whatsapp-conversation.entity';
import { WhatsappConnectionsModule } from '../whatsapp-connections/whatsapp-connections.module';
import { ProfilePhotosService } from './profile-photos.service';
import { ProfilePhotosController } from './profile-photos.controller';
@Module({
  imports: [
    TypeOrmModule.forFeature([Contact, WhatsappConversation]),
    WhatsappConnectionsModule,
  ],
  controllers: [ProfilePhotosController],
  providers: [ProfilePhotosService],
})
export class ProfilePhotosModule {}
