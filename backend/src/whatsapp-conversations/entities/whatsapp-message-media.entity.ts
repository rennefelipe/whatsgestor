import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { WhatsappMessage } from './whatsapp-message.entity';

@Entity({ name: 'whatsapp_message_media', schema: 'dbo' })
@Index('UQ_whatsapp_message_media_messageId', ['messageId'], { unique: true })
export class WhatsappMessageMedia {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'uniqueidentifier' }) messageId!: string;
  @OneToOne(() => WhatsappMessage, (message) => message.media, {
    onDelete: 'NO ACTION',
  })
  @JoinColumn({ name: 'messageId' })
  message!: WhatsappMessage;
  @Column({ type: 'nvarchar', length: 20 }) kind!:
    'image' | 'document' | 'audio';
  @Column({ type: 'nvarchar', length: 20, default: 'pending' }) availability!:
    'pending' | 'ready' | 'failed';
  @Column({ type: 'nvarchar', length: 100 }) mimeType!: string;
  @Column({ type: 'nvarchar', length: 255, nullable: true }) originalName!:
    string | null;
  @Column({ type: 'int', nullable: true }) sizeBytes!: number | null;
  @Column({ type: 'int', nullable: true }) durationSeconds!: number | null;
  @Column({ type: 'nvarchar', length: 64, nullable: true, select: false })
  storageKey!: string | null;
  @CreateDateColumn({ type: 'datetime2', precision: 7, default: () => 'SYSUTCDATETIME()' })
  createdAt!: Date;
  @UpdateDateColumn({ type: 'datetime2', precision: 7, default: () => 'SYSUTCDATETIME()' })
  updatedAt!: Date;
}
