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
import { organizationContexts } from './organization-context';
import type { OrganizationContext } from './organization-context';
import {
  contactPhoneMatcher,
  normalizeStoreName,
} from './contact-normalization';

// Temporary scan protection until a measured, indexed projection is authorized.
export const MAX_NORMALIZATION_CANDIDATES = 50000;

function escapeLike(value: string) {
  return value
    .replace(/~/g, '~~')
    .replace(/%/g, '~%')
    .replace(/_/g, '~_')
    .replace(/\[/g, '~[');
}

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

  private async contexts() {
    return organizationContexts(
      await this.organizations.find({ relations: { organizationType: true } }),
    );
  }

  // Read-only access for recipient revalidation; bounded SQL batches, no saves.
  async findByIds(ids: string[]) {
    const contexts = await this.contexts();
    const byId = new Map(
      contexts.map((context) => [
        context.organizationId.toLowerCase(),
        context,
      ]),
    );
    const results: Array<
      Contact & { organizationContext: OrganizationContext | null }
    > = [];
    const uniqueIds = [...new Set(ids)];
    for (let offset = 0; offset < uniqueIds.length; offset += 500) {
      const items = await this.contacts
        .createQueryBuilder('contact')
        .leftJoinAndSelect('contact.contactType', 'contactType')
        .leftJoinAndSelect('contact.organization', 'organization')
        .leftJoinAndSelect('organization.organizationType', 'organizationType')
        .where('contact.id IN (:...ids)', {
          ids: uniqueIds.slice(offset, offset + 500),
        })
        .getMany();
      results.push(
        ...items.map((contact) => ({
          ...contact,
          organizationContext: contact.organizationId
            ? (byId.get(contact.organizationId.toLowerCase()) ?? null)
            : null,
        })),
      );
    }
    return results;
  }

  async options() {
    const [contexts, stores] = await Promise.all([
      this.contexts(),
      this.contacts
        .createQueryBuilder('contact')
        .select('DISTINCT contact.storeName', 'name')
        .where('contact.storeName IS NOT NULL')
        // Binary collation preserves spellings for the shared NFC normalizer.
        .addSelect(
          'contact.storeName COLLATE Latin1_General_100_BIN2',
          'binaryName',
        )
        .orderBy('binaryName', 'ASC')
        .limit(MAX_NORMALIZATION_CANDIDATES + 1)
        .getRawMany<{ name: string }>(),
    ]);
    if (stores.length > MAX_NORMALIZATION_CANDIDATES)
      throw new BadRequestException(
        'Limite de opções de loja atingido. Nenhuma lista parcial foi retornada.',
      );
    const names = new Map<string, string>();
    for (const { name } of stores) {
      const key = normalizeStoreName(name);
      if (key && !names.has(key))
        names.set(key, name.normalize('NFC').trim().replace(/\s+/gu, ' '));
    }
    return {
      organizationContexts: contexts,
      storeNames: [...names.values()].sort((a, b) =>
        a.localeCompare(b, 'pt-BR'),
      ),
    };
  }

  async selectionCandidates(query: FindContactsQueryDto, limit: number) {
    const result = await this.findAll(
      { ...query, page: undefined, pageSize: undefined },
      limit,
    );
    if (!Array.isArray(result))
      throw new Error('Expected unpaginated selection read');
    return result;
  }

  async findAll(query: FindContactsQueryDto, selectionLimit?: number) {
    const contexts = await this.contexts();
    const byId = new Map(
      contexts.map((context) => [
        context.organizationId.toLowerCase(),
        context,
      ]),
    );
    const present = (contact: Contact) => ({
      ...contact,
      organizationContext: contact.organizationId
        ? (byId.get(contact.organizationId.toLowerCase()) ?? null)
        : null,
    });
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
    if (query.groupId || query.shoppingId) {
      const ids = contexts
        .filter(
          (context) =>
            (!query.groupId ||
              context.group?.id.toLowerCase() ===
                query.groupId.toLowerCase()) &&
            (!query.shoppingId ||
              context.shopping?.id.toLowerCase() ===
                query.shoppingId.toLowerCase()),
        )
        .map((context) => context.organizationId);
      // Delimited UUID membership avoids both partial matches and SQL Server's
      // 2100-parameter ceiling, without requiring a database compatibility change.
      if (!ids.length) builder.andWhere('1 = 0');
      else
        builder.andWhere(
          "CHARINDEX('|' + LOWER(CONVERT(nvarchar(36), contact.organizationId)) + '|', :contextIds) > 0",
          { contextIds: `|${ids.map((id) => id.toLowerCase()).join('|')}|` },
        );
    }
    if (query.contactName?.trim())
      builder.andWhere("contact.contactName LIKE :contactName ESCAPE '~'", {
        contactName: `%${escapeLike(query.contactName.trim())}%`,
      });
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
      const escapedSearch = escapeLike(query.search.trim());
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
    builder
      .orderBy('contact.contactName', 'ASC')
      .addOrderBy('contact.id', 'ASC');
    // SQL Server has no equivalent of libphonenumber + JS NFC. Do not use
    // collation/REPLACE as an approximate predicate: it can discard valid rows.
    // Apply exact shared semantics before computing totals and slicing pages.
    const normalized =
      !!query.phone?.trim() ||
      !!query.storeName?.trim() ||
      query.withoutStore !== undefined;
    if (normalized) {
      const store = normalizeStoreName(query.storeName);
      const phoneMatches = query.phone?.trim()
        ? contactPhoneMatcher(query.phone)
        : null;
      const items: Contact[] = [];
      let scanned = 0;
      let cursor: { id: string; name: string } | null = null;
      // Keyset batches retain SQL Server's name/id collation and order. Only
      // matching candidates are retained; raw contacts are released per batch.
      for (;;) {
        const batchQuery = builder.clone().limit(500);
        if (cursor)
          batchQuery.andWhere(
            '(contact.contactName > :cursorName OR (contact.contactName = :cursorName AND contact.id > :cursorId))',
            { cursorName: cursor.name, cursorId: cursor.id },
          );
        const batch = await batchQuery.getMany();
        scanned += batch.length;
        if (scanned > MAX_NORMALIZATION_CANDIDATES)
          throw new BadRequestException(
            'Limite de leitura para normalização atingido (50.000 candidatos). Refine os filtros. Nenhum resultado parcial foi retornado.',
          );
        for (const contact of batch)
          if (
            (!store || normalizeStoreName(contact.storeName) === store) &&
            (query.withoutStore === undefined ||
              (normalizeStoreName(contact.storeName) === null) ===
                query.withoutStore) &&
            (!phoneMatches || phoneMatches(contact.phone))
          ) {
            items.push(contact);
            if (selectionLimit !== undefined && items.length > selectionLimit)
              throw new BadRequestException(
                'Refine os filtros: o limite desta seleção e de 10.000 cadastros.',
              );
          }
        if (batch.length < 500) break;
        const last = batch[batch.length - 1];
        cursor = { id: last.id, name: last.contactName };
      }
      if (selectionLimit !== undefined && items.length > selectionLimit)
        throw new BadRequestException(
          'Refine os filtros: o limite desta seleção temporária é de 10.000 cadastros.',
        );
      if (query.page !== undefined || query.pageSize !== undefined) {
        const page = query.page ?? 1,
          pageSize = query.pageSize ?? 25;
        return {
          items: items
            .slice((page - 1) * pageSize, page * pageSize)
            .map(present),
          total: items.length,
          page,
          pageSize,
        };
      }
      return items.map(present);
    }
    if (selectionLimit !== undefined) builder.limit(selectionLimit + 1);
    if (query.page !== undefined || query.pageSize !== undefined) {
      const page = query.page ?? 1,
        pageSize = query.pageSize ?? 25;
      const [items, total] = await builder
        .skip((page - 1) * pageSize)
        .take(pageSize)
        .getManyAndCount();
      return { items: items.map(present), total, page, pageSize };
    }
    const items = await builder.getMany();
    if (selectionLimit !== undefined && items.length > selectionLimit)
      throw new BadRequestException(
        'Refine os filtros: o limite desta seleção temporária é de 10.000 cadastros.',
      );
    return items.map(present);
  }

  async findOne(
    id: string,
  ): Promise<Contact & { organizationContext: OrganizationContext | null }> {
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
    const contexts = await this.contexts();
    return {
      ...contact,
      organizationContext:
        contexts.find(
          (context) =>
            context.organizationId.toLowerCase() ===
            contact.organizationId?.toLowerCase(),
        ) ?? null,
    };
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
      contact,
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
    existing?: Contact,
  ): Promise<{ contactType: ContactType; organization: Organization | null }> {
    const contactType = await this.contactTypes.findOneBy({
      id: contactTypeId,
    });
    if (
      !contactType ||
      (!contactType.isActive &&
        contactTypeId.toLowerCase() !== existing?.contactTypeId.toLowerCase())
    ) {
      throw new BadRequestException(
        'O tipo de contato informado não existe ou está inativo.',
      );
    }

    if (organizationId == null) {
      return { contactType, organization: null };
    }
    const organization = await this.organizations.findOneBy({
      id: organizationId,
    });
    if (
      !organization ||
      (!organization.isActive &&
        organizationId.toLowerCase() !==
          existing?.organizationId?.toLowerCase())
    ) {
      throw new BadRequestException(
        'A organização informada não existe ou está inativa.',
      );
    }
    return { contactType, organization };
  }
}
