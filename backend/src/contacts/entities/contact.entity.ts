import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ContactType } from '../../contact-types/entities/contact-type.entity';
import { Organization } from '../../organizations/entities/organization.entity';

@Entity('contacts')
@Index('IX_contacts_organizationId', ['organizationId'])
@Index('IX_contacts_contactTypeId', ['contactTypeId'])
export class Contact {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uniqueidentifier', nullable: true })
  organizationId: string | null;

  @ManyToOne(() => Organization, { nullable: true, onDelete: 'NO ACTION' })
  @JoinColumn({ name: 'organizationId', referencedColumnName: 'id' })
  organization: Organization | null;

  @Column({ type: 'uniqueidentifier' })
  contactTypeId: string;

  @ManyToOne(() => ContactType, { nullable: false, onDelete: 'NO ACTION' })
  @JoinColumn({ name: 'contactTypeId', referencedColumnName: 'id' })
  contactType: ContactType;

  @Column({ type: 'nvarchar', length: 150, nullable: true })
  storeName: string | null;

  @Column({ type: 'nvarchar', length: 150 })
  contactName: string;

  @Column({ type: 'nvarchar', length: 30 })
  phone: string;

  @Column({ type: 'nvarchar', length: 200, nullable: true })
  email: string | null;

  @Column({ type: 'bit', default: true })
  isActive: boolean;

  @CreateDateColumn({ type: 'datetime2', default: () => 'SYSUTCDATETIME()' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'datetime2', default: () => 'SYSUTCDATETIME()' })
  updatedAt: Date;
}
