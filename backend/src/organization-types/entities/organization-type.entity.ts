import {
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  Column,
} from 'typeorm';

@Entity({ name: 'organization_types', schema: 'dbo' })
export class OrganizationType {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'nvarchar', length: 100 })
  name!: string;

  @Column({ type: 'bit', default: true })
  isActive!: boolean;

  @CreateDateColumn({ type: 'datetime2', precision: 7, default: () => 'SYSUTCDATETIME()' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'datetime2', precision: 7, default: () => 'SYSUTCDATETIME()' })
  updatedAt!: Date;
}
