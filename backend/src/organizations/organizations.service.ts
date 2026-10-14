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
    const references = await this.validateReferences(
      dto.organizationTypeId,
      dto.parentOrganizationId,
    );
    const organization = await this.organizations.save(
      this.organizations.create({ ...dto, ...references }),
    );
    return this.findOne(organization.id);
  }

  async update(id: string, dto: UpdateOrganizationDto): Promise<Organization> {
    const organization = await this.findOne(id);
    const organizationTypeId =
      dto.organizationTypeId ?? organization.organizationTypeId;
    const parentOrganizationId =
      dto.parentOrganizationId === undefined
        ? organization.parentOrganizationId
        : dto.parentOrganizationId;
    const references = await this.validateReferences(
      organizationTypeId,
      parentOrganizationId,
      id,
    );
    Object.assign(organization, dto);
    organization.organizationType = references.organizationType;
    organization.parentOrganization = references.parentOrganization;
    await this.organizations.save(organization);
    return this.findOne(id);
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
  ): Promise<{
    organizationType: OrganizationType;
    parentOrganization: Organization | null;
  }> {
    const organizationType = await this.organizationTypes.findOneBy({
      id: organizationTypeId,
      isActive: true,
    });
    if (!organizationType) {
      throw new BadRequestException(
        'O tipo de organização informado não existe ou está inativo.',
      );
    }

    if (!parentOrganizationId) {
      return { organizationType, parentOrganization: null };
    }
    if (parentOrganizationId === currentId) {
      throw new BadRequestException(
        'Uma organização não pode ser sua própria organização pai.',
      );
    }
    const parentOrganization = await this.organizations.findOneBy({
      id: parentOrganizationId,
    });
    if (!parentOrganization) {
      throw new BadRequestException(
        'A organização pai informada não foi encontrada.',
      );
    }
    return { organizationType, parentOrganization };
  }
}
