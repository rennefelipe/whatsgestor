import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Contact } from '../contacts/entities/contact.entity';
import { CreateContactTypeDto } from './dto/create-contact-type.dto';
import { UpdateContactTypeActiveDto } from './dto/update-contact-type-active.dto';
import { UpdateContactTypeDto } from './dto/update-contact-type.dto';
import { ContactType } from './entities/contact-type.entity';

@Injectable()
export class ContactTypesService {
  constructor(
    @InjectRepository(ContactType)
    private readonly contactTypes: Repository<ContactType>,
    @InjectRepository(Contact)
    private readonly contacts: Repository<Contact>,
  ) {}

  findAll(): Promise<ContactType[]> {
    return this.contactTypes.find({ order: { name: 'ASC' } });
  }

  async findOne(id: string): Promise<ContactType> {
    const contactType = await this.contactTypes.findOneBy({ id });
    if (!contactType) {
      throw new NotFoundException('Tipo de contato não encontrado.');
    }
    return contactType;
  }

  create(dto: CreateContactTypeDto): Promise<ContactType> {
    return this.contactTypes.save(this.contactTypes.create(dto));
  }

  async update(id: string, dto: UpdateContactTypeDto): Promise<ContactType> {
    const contactType = await this.findOne(id);
    Object.assign(contactType, dto);
    return this.contactTypes.save(contactType);
  }

  async updateActive(
    id: string,
    dto: UpdateContactTypeActiveDto,
  ): Promise<ContactType> {
    return this.update(id, dto);
  }

  async remove(id: string): Promise<void> {
    const contactType = await this.findOne(id);
    if (await this.contacts.existsBy({ contactTypeId: id })) {
      throw new ConflictException(
        'Não é possível excluir o tipo de contato porque está em uso.',
      );
    }
    await this.contactTypes.remove(contactType);
  }
}
