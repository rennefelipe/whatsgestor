import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import {
  ContactCampaignPreference as Preference,
  ContactCampaignPreferenceEvent as PreferenceEvent,
} from './entities/contact-campaign-preference.entity';
import { ContactsService } from './contacts.service';
import { normalizeContactPhone } from './contact-normalization';
import {
  CreateCampaignPreferenceDto,
  RevokeCampaignPreferenceDto,
  CampaignPreferencePageDto,
} from './dto/campaign-preference.dto';
import type { UserResponse } from '../users/users.service';

export interface CampaignRestriction {
  normalizedPhone?: string;
  whatsappIdentity?: string;
  shoppingId: string | null;
  connectionId?: string;
}

export interface CampaignPreferencesSnapshot {
  status: 'available' | 'not_configured';
  rules: CampaignRestriction[];
}

@Injectable()
export class ContactCampaignPreferencesService {
  constructor(
    private readonly database: DataSource,
    private readonly contacts: ContactsService,
  ) {}

  private unavailable(): never {
    throw new ServiceUnavailableException(
      'Preferências de campanhas indisponíveis. Verifique a estrutura e a conexão do banco; nenhuma autorização de envio foi concedida.',
    );
  }
  async snapshot(): Promise<CampaignPreferencesSnapshot> {
    try {
      const rows = await this.database
        .getRepository(Preference)
        .find({ where: { isActive: true }, take: 50001 });
      if (rows.length > 50000) this.unavailable();
      for (const row of rows) {
        const validPhone =
          row.normalizedPhone &&
          normalizeContactPhone(row.normalizedPhone).normalizedPhone ===
            row.normalizedPhone &&
          !row.whatsappIdentity &&
          !row.connectionId;
        const validIdentity =
          !row.normalizedPhone &&
          /^\d+@lid$/.test(row.whatsappIdentity ?? '') &&
          row.connectionId &&
          row.evidenceConversationId;
        if (!validPhone && !validIdentity) this.unavailable();
      }
      return {
        status: 'available',
        rules: rows.map((row) => ({
          ...(row.normalizedPhone
            ? { normalizedPhone: row.normalizedPhone }
            : {}),
          ...(row.whatsappIdentity
            ? {
                whatsappIdentity: row.whatsappIdentity,
                connectionId: row.connectionId!,
              }
            : {}),
          shoppingId: row.shoppingId,
        })),
      };
    } catch {
      return this.unavailable();
    }
  }

  private async identities(contactId: string) {
    // An explicit contact/conversation link proves only this identity in this
    // connection. It does not establish a LID <-> phone equivalence.
    return this.database
      .createQueryBuilder()
      .select('conversation.id', 'conversationId')
      .addSelect('conversation.connectionId', 'connectionId')
      .addSelect('conversation.remoteJid', 'whatsappIdentity')
      .from('dbo.whatsapp_conversations', 'conversation')
      .where('conversation.contactId = :contactId', { contactId })
      .orderBy('conversation.id', 'ASC')
      .limit(1001)
      .getRawMany<{
        conversationId: string;
        connectionId: string;
        whatsappIdentity: string;
      }>();
  }

  async list(contactId: string, page: CampaignPreferencePageDto) {
    const contact = await this.contacts.findOne(contactId);
    const phone = normalizeContactPhone(contact.phone).normalizedPhone;
    try {
      const identities = await this.identities(contact.id);
      if (identities.length > 1000) this.unavailable();
      const lids = identities.filter((identity) =>
        /^\d+@lid$/.test(identity.whatsappIdentity),
      );
      const query = this.database
        .getRepository(Preference)
        .createQueryBuilder('preference')
        .where('preference.sourceContactId = :contactId', { contactId });
      if (phone)
        query.orWhere('preference.normalizedPhone = :phone', { phone });
      // Bounded to remain below SQL Server's parameter limit.
      for (const [index, identity] of lids.entries())
        query.orWhere(
          `(preference.whatsappIdentity = :jid${index} AND preference.connectionId = :connection${index})`,
          {
            [`jid${index}`]: identity.whatsappIdentity,
            [`connection${index}`]: identity.connectionId,
          },
        );
      const [items, total] = await query
        .orderBy('preference.createdAt', 'DESC')
        .addOrderBy('preference.id', 'DESC')
        .skip((page.page - 1) * page.pageSize)
        .take(page.pageSize)
        .getManyAndCount();
      let affectedContacts = 0;
      if (phone) {
        const matches = await this.contacts.findAll({
          phone,
          page: 1,
          pageSize: 1,
        });
        if (!Array.isArray(matches)) affectedContacts = matches.total;
      }
      return {
        items,
        total,
        page: page.page,
        pageSize: page.pageSize,
        normalizedPhone: phone,
        affectedContacts,
        identities: lids,
      };
    } catch {
      return this.unavailable();
    }
  }

  async listAll(page: CampaignPreferencePageDto, actor: UserResponse) {
    this.authorize(actor);
    try {
      const [items, total] = await this.database
        .getRepository(Preference)
        .findAndCount({
          order: { createdAt: 'DESC', id: 'DESC' },
          skip: (page.page - 1) * page.pageSize,
          take: page.pageSize,
        });
      return {
        items,
        total,
        page: page.page,
        pageSize: page.pageSize,
        normalizedPhone: null,
        affectedContacts: 0,
        identities: [],
      };
    } catch {
      return this.unavailable();
    }
  }

  private authorize(actor: UserResponse) {
    if (!actor.isAdmin || !actor.isActive)
      throw new ForbiddenException(
        'Somente administradores ativos podem gerenciar preferências de campanhas.',
      );
  }

  private async audit(
    manager: EntityManager,
    row: Preference,
    actor: UserResponse,
    action: 'block' | 'revoke',
    reason: string,
    before: Preference | null,
  ) {
    await manager.getRepository(PreferenceEvent).save(
      manager.getRepository(PreferenceEvent).create({
        preferenceId: row.id,
        preferenceVersion: row.version,
        actorId: actor.id,
        actorUsername: actor.username,
        action,
        reason,
        beforeState: before ? JSON.stringify(before) : null,
        afterState: JSON.stringify(row),
      }),
    );
  }
  private mutationError(error: unknown): never {
    if (
      error instanceof BadRequestException ||
      error instanceof ConflictException ||
      error instanceof NotFoundException
    )
      throw error;
    const code =
      (error as { driverError?: { number?: number }; number?: number })
        ?.driverError?.number ?? (error as { number?: number })?.number;
    if (code === 2601 || code === 2627)
      throw new ConflictException(
        'Já existe um bloqueio ativo para esta identidade e abrangência. Atualize a consulta.',
      );
    return this.unavailable();
  }

  async create(
    contactId: string,
    dto: CreateCampaignPreferenceDto,
    actor: UserResponse,
  ) {
    this.authorize(actor);
    const contact = await this.contacts.findOne(contactId);
    if (dto.reason.trim().length < 3)
      throw new BadRequestException('Informe o motivo do bloqueio.');
    if (dto.shoppingId) {
      const options = await this.contacts.options();
      if (
        !options.organizationContexts.some(
          (context) =>
            context.organizationId.toLowerCase() ===
              dto.shoppingId!.toLowerCase() &&
            context.shopping?.id.toLowerCase() ===
              dto.shoppingId!.toLowerCase() &&
            !context.hierarchyIssue,
        )
      )
        throw new BadRequestException(
          'Selecione um shopping com tipo e hierarquia válidos.',
        );
    }
    const target: Pick<
      Preference,
      | 'normalizedPhone'
      | 'whatsappIdentity'
      | 'connectionId'
      | 'evidenceConversationId'
    > = {
      normalizedPhone: null,
      whatsappIdentity: null,
      connectionId: null,
      evidenceConversationId: null,
    };
    try {
      if (dto.target === 'phone') {
        target.normalizedPhone = normalizeContactPhone(
          contact.phone,
        ).normalizedPhone;
        if (!target.normalizedPhone)
          throw new BadRequestException(
            'O telefone não possui normalização válida. Corrija o cadastro ou utilize uma identidade comprovada.',
          );
      } else {
        const links = await this.identities(contact.id);
        if (links.length > 1000) this.unavailable();
        const proof = links.find(
          (link) =>
            link.conversationId.toLowerCase() ===
              dto.evidenceConversationId?.toLowerCase() &&
            /^\d+@lid$/.test(link.whatsappIdentity),
        );
        if (!proof)
          throw new BadRequestException(
            'Identidade LID sem vínculo comprovado neste contato e conexão.',
          );
        Object.assign(target, {
          whatsappIdentity: proof.whatsappIdentity,
          connectionId: proof.connectionId,
          evidenceConversationId: proof.conversationId,
        });
      }
      return await this.database.transaction(async (manager) => {
        const repository = manager.getRepository(Preference);
        const row = await repository.save(
          repository.create({
            ...target,
            shoppingId: dto.shoppingId ?? null,
            sourceContactId: contact.id,
            reason: dto.reason.trim(),
            createdBy: actor.id,
            isActive: true,
            version: 1,
            revokedAt: null,
          }),
        );
        await this.audit(manager, row, actor, 'block', dto.reason.trim(), null);
        return row;
      });
    } catch (error) {
      return this.mutationError(error);
    }
  }

  async revoke(
    id: string,
    dto: RevokeCampaignPreferenceDto,
    actor: UserResponse,
  ) {
    this.authorize(actor);
    if (!dto.confirmed || dto.reason.trim().length < 3)
      throw new BadRequestException(
        'Confirme a revogação e informe a justificativa.',
      );
    try {
      return await this.database.transaction(async (manager) => {
        const repository = manager.getRepository(Preference);
        const before = await repository.findOneBy({ id });
        if (!before) throw new NotFoundException('Restrição não encontrada.');
        if (!before.isActive || before.version !== dto.version)
          throw new ConflictException(
            'Restrição alterada por outro usuário. Atualize antes de continuar.',
          );
        const result = await repository.update(
          { id, version: dto.version, isActive: true },
          {
            isActive: false,
            version: dto.version + 1,
            revokedAt: () => 'SYSUTCDATETIME()',
          },
        );
        if (result.affected !== 1)
          throw new ConflictException(
            'Restrição alterada por outro usuário. Atualize antes de continuar.',
          );
        const row = await repository.findOneByOrFail({ id });
        await this.audit(
          manager,
          row,
          actor,
          'revoke',
          dto.reason.trim(),
          before,
        );
        return row;
      });
    } catch (error) {
      return this.mutationError(error);
    }
  }

  async events(id: string, page: CampaignPreferencePageDto) {
    try {
      const [items, total] = await this.database
        .getRepository(PreferenceEvent)
        .findAndCount({
          where: { preferenceId: id },
          order: { createdAt: 'DESC', id: 'DESC' },
          skip: (page.page - 1) * page.pageSize,
          take: page.pageSize,
        });
      return { items, total, page: page.page, pageSize: page.pageSize };
    } catch {
      return this.unavailable();
    }
  }
}
