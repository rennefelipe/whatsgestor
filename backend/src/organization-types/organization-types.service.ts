import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Organization } from '../organizations/entities/organization.entity';
import { CreateOrganizationTypeDto } from './dto/create-organization-type.dto';
import { UpdateOrganizationTypeActiveDto } from './dto/update-organization-type-active.dto';
import { UpdateOrganizationTypeDto } from './dto/update-organization-type.dto';
import { OrganizationType } from './entities/organization-type.entity';
import { organizationRole } from '../contacts/organization-context';

@Injectable()
export class OrganizationTypesService {
  constructor(
    @InjectRepository(OrganizationType)
    private readonly organizationTypes: Repository<OrganizationType>,
    @InjectRepository(Organization)
    private readonly organizations: Repository<Organization>,
  ) {}

  findAll(): Promise<OrganizationType[]> {
    return this.organizationTypes.find({ order: { name: 'ASC' } });
  }

  async findOne(id: string): Promise<OrganizationType> {
    const organizationType = await this.organizationTypes.findOneBy({ id });
    if (!organizationType) {
      throw new NotFoundException('Tipo de organização não encontrado.');
    }
    return organizationType;
  }

  create(dto: CreateOrganizationTypeDto): Promise<OrganizationType> {
    return this.organizationTypes.save(this.organizationTypes.create(dto));
  }

  async update(
    id: string,
    dto: UpdateOrganizationTypeDto,
  ): Promise<OrganizationType> {
    return this.organizationTypes.manager.transaction(async (manager) => {
      await manager.query(
        'SELECT TOP (1) [id] FROM [dbo].[organizations] WITH (TABLOCKX,HOLDLOCK)',
      );
      const types = manager.getRepository(OrganizationType);
      const organizationType = await types.findOneBy({ id });
      if (!organizationType)
        throw new NotFoundException('Tipo de organização não encontrado.');
      if (
        dto.name !== undefined &&
        organizationRole(dto.name) !==
          organizationRole(organizationType.name) &&
        (await manager
          .getRepository(Organization)
          .existsBy({ organizationTypeId: id }))
      )
        throw new ConflictException(
          'Este tipo está em uso. Alterar sua classificação reclassificaria organizações existentes; cadastre o tipo desejado e revise os vínculos explicitamente em Organizações.',
        );
      Object.assign(organizationType, dto);
      return types.save(organizationType);
    });
  }

  async updateActive(
    id: string,
    dto: UpdateOrganizationTypeActiveDto,
  ): Promise<OrganizationType> {
    return this.update(id, dto);
  }

  async remove(id: string): Promise<void> {
    const organizationType = await this.findOne(id);
    if (await this.organizations.existsBy({ organizationTypeId: id })) {
      throw new ConflictException(
        'Não é possível excluir o tipo de organização porque está em uso.',
      );
    }
    await this.organizationTypes.remove(organizationType);
  }
}
