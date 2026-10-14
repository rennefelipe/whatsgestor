import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import { ContactType } from '../contact-types/entities/contact-type.entity';
import { Organization } from '../organizations/entities/organization.entity';
import { CreateContactDto } from './dto/create-contact.dto';
import { FindContactsQueryDto } from './dto/find-contacts-query.dto';
import { UpdateContactActiveDto } from './dto/update-contact-active.dto';
import { UpdateContactDto } from './dto/update-contact.dto';
import { Contact } from './entities/contact.entity';

@Injectable()
export class ContactsService {
  constructor(
    @InjectRepository(Contact)
    private readonly contacts: Repository<Contact>,
    @InjectRepository(ContactType)
    private readonly contactTypes: Repository<ContactType>,
    @InjectRepository(Organization)
    private readonly organizations: Repository<Organization>,
  ) {}

  findAll(query: FindContactsQueryDto): Promise<Contact[]> {
    const builder = this.contacts
      .createQueryBuilder('contact')
      .leftJoinAndSelect('contact.contactType', 'contactType')
      .leftJoinAndSelect('contact.organization', 'organization')
      .leftJoinAndSelect('organization.organizationType', 'organizationType')
      .leftJoinAndSelect(
        'organization.parentOrganization',
        'parentOrganization',
      );

    if (query.organizationId) {
      builder.andWhere('contact.organizationId = :organizationId', {
        organizationId: query.organizationId,
      });
    }
    if (query.contactTypeId) {
      builder.andWhere('contact.contactTypeId = :contactTypeId', {
        contactTypeId: query.contactTypeId,
      });
    }
    if (query.isActive !== undefined) {
      builder.andWhere('contact.isActive = :isActive', {
        isActive: query.isActive,
      });
    }
    if (query.search?.trim()) {
      const escapedSearch = query.search
        .trim()
        .replace(/~/g, '~~')
        .replace(/%/g, '~%')
        .replace(/_/g, '~_')
        .replace(/\[/g, '~[');
      builder.andWhere(
        new Brackets((searchBuilder) => {
          searchBuilder
            .where("contact.contactName LIKE :search ESCAPE '~'")
            .orWhere("contact.storeName LIKE :search ESCAPE '~'")
            .orWhere("contact.phone LIKE :search ESCAPE '~'")
            .orWhere("contact.email LIKE :search ESCAPE '~'")
            .orWhere("organization.name LIKE :search ESCAPE '~'")
            .orWhere("parentOrganization.name LIKE :search ESCAPE '~'");
        }),
        { search: `%${escapedSearch}%` },
      );
    }
    return builder.orderBy('contact.contactName', 'ASC').getMany();
  }

  async findOne(id: string): Promise<Contact> {
    const contact = await this.contacts.findOne({
      where: { id },
      relations: {
        contactType: true,
        organization: {
          organizationType: true,
          parentOrganization: true,
        },
      },
    });
    if (!contact) {
      throw new NotFoundException('Contato não encontrado.');
    }
    return contact;
  }

  async create(dto: CreateContactDto): Promise<Contact> {
    const references = await this.validateReferences(
      dto.contactTypeId,
      dto.organizationId,
    );
    const contact = await this.contacts.save(
      this.contacts.create({ ...dto, ...references }),
    );
    return this.findOne(contact.id);
  }

  async update(id: string, dto: UpdateContactDto): Promise<Contact> {
    const contact = await this.findOne(id);
    const contactTypeId = dto.contactTypeId ?? contact.contactTypeId;
    const organizationId =
      dto.organizationId === undefined
        ? contact.organizationId
        : dto.organizationId;
    const references = await this.validateReferences(
      contactTypeId,
      organizationId,
    );
    Object.assign(contact, dto);
    contact.contactType = references.contactType;
    contact.organization = references.organization;
    await this.contacts.save(contact);
    return this.findOne(id);
  }

  async updateActive(
    id: string,
    dto: UpdateContactActiveDto,
  ): Promise<Contact> {
    return this.update(id, dto);
  }

  async remove(id: string): Promise<void> {
    const contact = await this.findOne(id);
    await this.contacts.remove(contact);
  }

  private async validateReferences(
    contactTypeId: string,
    organizationId?: string | null,
  ): Promise<{ contactType: ContactType; organization: Organization | null }> {
    const contactType = await this.contactTypes.findOneBy({
      id: contactTypeId,
      isActive: true,
    });
    if (!contactType) {
      throw new BadRequestException(
        'O tipo de contato informado não existe ou está inativo.',
      );
    }

    if (organizationId == null) {
      return { contactType, organization: null };
    }
    const organization = await this.organizations.findOneBy({
      id: organizationId,
      isActive: true,
    });
    if (!organization) {
      throw new BadRequestException(
        'A organização informada não existe ou está inativa.',
      );
    }
    return { contactType, organization };
  }
}
