import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('contact_types')
export class ContactType {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'nvarchar', length: 100 })
  name: string;

  @Column({ type: 'bit', default: true })
  isActive: boolean;

  @CreateDateColumn({ type: 'datetime2', default: () => 'SYSUTCDATETIME()' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'datetime2', default: () => 'SYSUTCDATETIME()' })
  updatedAt: Date;
}
