import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrganizationTypesController } from './organization-types.controller';
import { OrganizationTypesService } from './organization-types.service';
import { Organization } from '../organizations/entities/organization.entity';
import { OrganizationType } from './entities/organization-type.entity';

@Module({
  imports: [TypeOrmModule.forFeature([OrganizationType, Organization])],
  controllers: [OrganizationTypesController],
  providers: [OrganizationTypesService],
})
export class OrganizationTypesModule {}
