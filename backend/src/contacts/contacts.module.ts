import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ContactType } from '../contact-types/entities/contact-type.entity';
import { Organization } from '../organizations/entities/organization.entity';
import { ContactsController } from './contacts.controller';
import { ContactsService } from './contacts.service';
import { Contact } from './entities/contact.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Contact, ContactType, Organization])],
  controllers: [ContactsController],
  providers: [ContactsService],
})
export class ContactsModule {}
