import {
  OneToOne,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { WhatsappMessageMedia } from './whatsapp-message-media.entity';

@Entity({ name: 'whatsapp_messages', schema: 'dbo' })
@Index(
  'UQ_whatsapp_messages_conversation_message_fromMe',
  ['conversationId', 'whatsappMessageId', 'fromMe'],
  { unique: true },
)
export class WhatsappMessage {
  @OneToOne(() => WhatsappMessageMedia, (media) => media.message)
  media!: WhatsappMessageMedia | null;
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uniqueidentifier' })
  conversationId!: string;

  @Column({ type: 'nvarchar', length: 255 })
  whatsappMessageId!: string;

  @Column({ type: 'bit' })
  fromMe!: boolean;

  @Column({ type: 'nvarchar', length: 50, default: 'text' })
  messageType!: string;

  @Column({ type: 'nvarchar', length: 'MAX', nullable: true })
  textContent!: string | null;

  @Column({ type: 'datetime2', precision: 7, nullable: true })
  messageTimestamp!: Date | null;

  @Column({ type: 'nvarchar', length: 30, default: 'received' })
  status!: string;

  @CreateDateColumn({
    type: 'datetime2', precision: 7,
    default: () => 'SYSUTCDATETIME()',
  })
  createdAt!: Date;

  @UpdateDateColumn({
    type: 'datetime2', precision: 7,
    default: () => 'SYSUTCDATETIME()',
  })
  updatedAt!: Date;
}
