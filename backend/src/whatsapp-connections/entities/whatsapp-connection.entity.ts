import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export const whatsappConnectionStatuses = [
  'disconnected',
  'connecting',
  'qr_ready',
  'connected',
  'reconnecting',
  'error',
] as const;

export type WhatsappConnectionStatus =
  (typeof whatsappConnectionStatuses)[number];

@Entity('whatsapp_connections')
export class WhatsappConnection {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'nvarchar', length: 150 })
  name: string;

  @Column({ type: 'nvarchar', length: 30, nullable: true })
  phoneNumber: string | null;

  @Column({
    type: 'nvarchar',
    length: 30,
    default: 'disconnected',
  })
  status: WhatsappConnectionStatus;

  @Column({ type: 'bit', default: true })
  isActive: boolean;

  @CreateDateColumn({
    type: 'datetime2',
    default: () => 'SYSUTCDATETIME()',
  })
  createdAt: Date;

  @UpdateDateColumn({
    type: 'datetime2',
    default: () => 'SYSUTCDATETIME()',
  })
  updatedAt: Date;

  @Column({ type: 'datetime2', nullable: true })
  lastConnectedAt: Date | null;

  @Column({ type: 'datetime2', nullable: true })
  lastDisconnectedAt: Date | null;
}
