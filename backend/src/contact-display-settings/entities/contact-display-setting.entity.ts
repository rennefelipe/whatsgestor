import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'contact_display_settings', schema: 'dbo' })
@Index('UQ_contact_display_settings_fieldKey', ['fieldKey'], { unique: true })
export class ContactDisplaySetting {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'nvarchar', length: 50 })
  fieldKey!: string;

  @Column({ type: 'bit', default: true })
  isVisible!: boolean;

  @Column({ type: 'int' })
  displayOrder!: number;

  @CreateDateColumn({ type: 'datetime2', precision: 7, default: () => 'SYSUTCDATETIME()' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'datetime2', precision: 7, default: () => 'SYSUTCDATETIME()' })
  updatedAt!: Date;
}
