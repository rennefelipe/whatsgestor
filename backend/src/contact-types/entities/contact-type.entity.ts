import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'contact_types', schema: 'dbo' })
export class ContactType {
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
