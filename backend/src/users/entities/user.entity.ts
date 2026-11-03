import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'users', schema: 'dbo' })
@Index('UQ_users_username', ['username'], { unique: true })
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'nvarchar', length: 100 })
  username!: string;

  @Column({ type: 'nvarchar', length: 255, select: false })
  passwordHash!: string;

  @Column({ type: 'bit', default: false })
  isAdmin!: boolean;

  @Column({ type: 'bit', default: false })
  canDelete!: boolean;

  @Column({ type: 'bit', default: true })
  isActive!: boolean;

  @CreateDateColumn({ type: 'datetime2', precision: 7, default: () => 'SYSUTCDATETIME()' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'datetime2', precision: 7, default: () => 'SYSUTCDATETIME()' })
  updatedAt!: Date;
}
