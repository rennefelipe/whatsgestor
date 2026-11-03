import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ContactsModule } from '../contacts/contacts.module';
import { WhatsappConversation } from '../whatsapp-conversations/entities/whatsapp-conversation.entity';
import { RecipientCatalogService } from './recipient-catalog.service';
import { RecipientSelectionsService } from './recipient-selections.service';
import { RecipientSelectionsController } from './recipient-selections.controller';
import {
  SelectionStore,
  SqlRecipientSelectionStore,
} from './recipient-selection-store';
import { recipientSelectionEntities } from './entities/recipient-selection.entity';

@Module({
  imports: [
    ContactsModule,
    TypeOrmModule.forFeature([
      WhatsappConversation,
      ...recipientSelectionEntities,
    ]),
  ],
  providers: [
    RecipientCatalogService,
    RecipientSelectionsService,
    { provide: SelectionStore, useClass: SqlRecipientSelectionStore },
  ],
  controllers: [RecipientSelectionsController],
})
export class BulkSendModule {}
