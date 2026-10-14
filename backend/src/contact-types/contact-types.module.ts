import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Contact } from '../contacts/entities/contact.entity';
import { ContactTypesController } from './contact-types.controller';
import { ContactTypesService } from './contact-types.service';
import { ContactType } from './entities/contact-type.entity';

@Module({
  imports: [TypeOrmModule.forFeature([ContactType, Contact])],
  controllers: [ContactTypesController],
  providers: [ContactTypesService],
})
export class ContactTypesModule {}
