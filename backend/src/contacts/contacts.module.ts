import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ContactType } from '../contact-types/entities/contact-type.entity';
import { Organization } from '../organizations/entities/organization.entity';
import { ContactsController } from './contacts.controller';
import { ContactsService } from './contacts.service';
import { Contact } from './entities/contact.entity';
import { ContactCampaignPreferencesService } from './contact-campaign-preferences.service';
import { ContactCampaignPreferencesController } from './contact-campaign-preferences.controller';
import {
  ContactCampaignPreference,
  ContactCampaignPreferenceEvent,
} from './entities/contact-campaign-preference.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Contact,
      ContactType,
      Organization,
      ContactCampaignPreference,
      ContactCampaignPreferenceEvent,
    ]),
  ],
  controllers: [ContactCampaignPreferencesController, ContactsController],
  providers: [ContactsService, ContactCampaignPreferencesService],
  exports: [ContactsService, ContactCampaignPreferencesService],
})
export class ContactsModule {}
