import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Contact } from '../contacts/entities/contact.entity';
import { OrganizationType } from '../organization-types/entities/organization-type.entity';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { UpdateOrganizationActiveDto } from './dto/update-organization-active.dto';
import { UpdateOrganizationDto } from './dto/update-organization.dto';
import { Organization } from './entities/organization.entity';
import { organizationRole } from '../contacts/organization-context';

const organizationRelations = {
  organizationType: true,
  parentOrganization: true,
};

@Injectable()
export class OrganizationsService {
  constructor(
    @InjectRepository(Organization)
    private readonly organizations: Repository<Organization>,
    @InjectRepository(OrganizationType)
    private readonly organizationTypes: Repository<OrganizationType>,
    @InjectRepository(Contact)
    private readonly contacts: Repository<Contact>,
  ) {}

  findAll(): Promise<Organization[]> {
    return this.organizations.find({
      relations: organizationRelations,
      order: { name: 'ASC' },
    });
  }

  async findOne(id: string): Promise<Organization> {
    const organization = await this.organizations.findOne({
      where: { id },
      relations: organizationRelations,
    });
    if (!organization) {
      throw new NotFoundException('Organização não encontrada.');
    }
    return organization;
  }

  async create(dto: CreateOrganizationDto): Promise<Organization> {
    return this.organizations.manager.transaction(async (manager) => {
      // Serialize hierarchy mutations, including concurrent A->B / B->A edits.
      await manager.query(
        'SELECT TOP (1) [id] FROM [dbo].[organizations] WITH (TABLOCKX,HOLDLOCK)',
      );
      const organizations = manager.getRepository(Organization);
      const references = await this.validateReferences(
        dto.organizationTypeId,
        dto.parentOrganizationId,
        undefined,
        organizations,
        manager.getRepository(OrganizationType),
      );
      const saved = await organizations.save(
        organizations.create({ ...dto, ...references }),
      );
      return organizations.findOneOrFail({
        where: { id: saved.id },
        relations: organizationRelations,
      });
    });
  }

  async update(id: string, dto: UpdateOrganizationDto): Promise<Organization> {
    return this.organizations.manager.transaction(async (manager) => {
      await manager.query(
        'SELECT TOP (1) [id] FROM [dbo].[organizations] WITH (TABLOCKX,HOLDLOCK)',
      );
      const organizations = manager.getRepository(Organization);
      const organization = await organizations.findOne({
        where: { id },
        relations: organizationRelations,
      });
      if (!organization)
        throw new NotFoundException('Organização não encontrada.');
      const organizationTypeId =
        dto.organizationTypeId ?? organization.organizationTypeId;
      const parentOrganizationId =
        dto.parentOrganizationId === undefined
          ? organization.parentOrganizationId
          : dto.parentOrganizationId;
      const changed =
        organizationTypeId.toLowerCase() !==
          organization.organizationTypeId.toLowerCase() ||
        (parentOrganizationId?.toLowerCase() ?? null) !==
          (organization.parentOrganizationId?.toLowerCase() ?? null);
      // Legacy links are not silently rewritten, nor must a name/status edit repair them.
      const references = changed
        ? await this.validateReferences(
            organizationTypeId,
            parentOrganizationId,
            id,
            organizations,
            manager.getRepository(OrganizationType),
          )
        : {
            organizationType: organization.organizationType,
            parentOrganization: organization.parentOrganization,
          };
      Object.assign(organization, dto);
      organization.organizationType = references.organizationType;
      organization.parentOrganization = references.parentOrganization;
      await organizations.save(organization);
      return organizations.findOneOrFail({
        where: { id },
        relations: organizationRelations,
      });
    });
  }

  async updateActive(
    id: string,
    dto: UpdateOrganizationActiveDto,
  ): Promise<Organization> {
    return this.update(id, dto);
  }

  async remove(id: string): Promise<void> {
    const organization = await this.findOne(id);
    if (await this.organizations.existsBy({ parentOrganizationId: id })) {
      throw new ConflictException(
        'Não é possível excluir a organização porque possui organizações filhas.',
      );
    }
    if (await this.contacts.existsBy({ organizationId: id })) {
      throw new ConflictException(
        'Não é possível excluir a organização porque possui contatos vinculados.',
      );
    }
    await this.organizations.remove(organization);
  }

  private async validateReferences(
    organizationTypeId: string,
    parentOrganizationId?: string | null,
    currentId?: string,
    organizations: Repository<Organization> = this.organizations,
    organizationTypes: Repository<OrganizationType> = this.organizationTypes,
  ): Promise<{
    organizationType: OrganizationType;
    parentOrganization: Organization | null;
  }> {
    const organizationType = await organizationTypes.findOneBy({
      id: organizationTypeId,
      isActive: true,
    });
    if (!organizationType) {
      throw new BadRequestException(
        'O tipo de organização informado não existe ou está inativo.',
      );
    }

    const role = organizationRole(organizationType.name);
    if (role === 'group' && parentOrganizationId)
      throw new BadRequestException(
        'Um grupo não pode possuir organização pai.',
      );
    if (role === 'shopping' && !parentOrganizationId)
      throw new BadRequestException(
        'Selecione o grupo responsável pelo shopping.',
      );
    if (currentId) {
      const children = await organizations.find({
        where: { parentOrganizationId: currentId },
        relations: { organizationType: true },
      });
      if (
        children.some(
          (child) =>
            organizationRole(child.organizationType?.name) === 'shopping',
        ) &&
        (role !== 'group' || parentOrganizationId)
      )
        throw new BadRequestException(
          'Esta alteração deixaria shoppings vinculados a um grupo inválido.',
        );
    }
    if (!parentOrganizationId) {
      return { organizationType, parentOrganization: null };
    }
    if (parentOrganizationId.toLowerCase() === currentId?.toLowerCase()) {
      throw new BadRequestException(
        'Uma organização não pode ser sua própria organização pai.',
      );
    }
    const parentOrganization = await organizations.findOne({
      where: { id: parentOrganizationId },
      relations: { organizationType: true },
    });
    if (!parentOrganization) {
      throw new BadRequestException(
        'A organização pai informada não foi encontrada.',
      );
    }
    if (
      role === 'shopping' &&
      (!parentOrganization.isActive ||
        organizationRole(parentOrganization.organizationType?.name) !==
          'group' ||
        !parentOrganization.organizationType?.isActive ||
        parentOrganization.parentOrganizationId)
    )
      throw new BadRequestException(
        'O shopping deve pertencer a um grupo ativo, sem organização pai.',
      );
    const visited = new Set(currentId ? [currentId.toLowerCase()] : []);
    let ancestor: Organization | null = parentOrganization;
    while (ancestor) {
      const key = ancestor.id.toLowerCase();
      if (visited.has(key) || visited.size >= 1000)
        throw new BadRequestException(
          'O vínculo informado cria ou contém um ciclo na hierarquia.',
        );
      visited.add(key);
      if (!ancestor.parentOrganizationId) break;
      ancestor = await organizations.findOne({
        where: { id: ancestor.parentOrganizationId },
      });
      if (!ancestor)
        throw new BadRequestException(
          'A hierarquia pai possui um vínculo inexistente.',
        );
    }
    return { organizationType, parentOrganization };
  }
}
