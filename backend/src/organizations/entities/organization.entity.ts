import {
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  Column,
} from 'typeorm';
import { OrganizationType } from '../../organization-types/entities/organization-type.entity';

@Entity('organizations')
@Index('IX_organizations_organizationTypeId', ['organizationTypeId'])
@Index('IX_organizations_parentOrganizationId', ['parentOrganizationId'])
export class Organization {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'nvarchar', length: 150 })
  name: string;

  @Column({ type: 'uniqueidentifier' })
  organizationTypeId: string;

  @ManyToOne(() => OrganizationType, { nullable: false, onDelete: 'NO ACTION' })
  @JoinColumn({ name: 'organizationTypeId', referencedColumnName: 'id' })
  organizationType: OrganizationType;

  @Column({ type: 'uniqueidentifier', nullable: true })
  parentOrganizationId: string | null;

  @ManyToOne(() => Organization, (organization) => organization.children, {
    nullable: true,
    onDelete: 'NO ACTION',
  })
  @JoinColumn({ name: 'parentOrganizationId', referencedColumnName: 'id' })
  parentOrganization: Organization | null;

  @OneToMany(
    () => Organization,
    (organization) => organization.parentOrganization,
  )
  children: Organization[];

  @Column({ type: 'bit', default: true })
  isActive: boolean;

  @CreateDateColumn({ type: 'datetime2', default: () => 'SYSUTCDATETIME()' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'datetime2', default: () => 'SYSUTCDATETIME()' })
  updatedAt: Date;
}
