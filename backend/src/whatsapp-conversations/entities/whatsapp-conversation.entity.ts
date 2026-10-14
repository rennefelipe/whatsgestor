import {
  Column,
  Check,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Contact } from '../../contacts/entities/contact.entity';
import { User } from '../../users/entities/user.entity';

@Entity('whatsapp_conversations')
@Index(
  'UQ_whatsapp_conversations_connection_remoteJid',
  ['connectionId', 'remoteJid'],
  { unique: true },
)
@Index('IX_whatsapp_conversations_contactId', ['contactId'])
@Index('IX_whatsapp_conversations_attendanceStatus', ['attendanceStatus'])
@Index('IX_whatsapp_conversations_assignedUserId', ['assignedUserId'])
@Check(
  'CK_whatsapp_conversations_attendanceStatus',
  "[attendanceStatus] IN (N'waiting', N'in_progress', N'finished')",
)
export class WhatsappConversation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uniqueidentifier' })
  connectionId: string;

  @Column({ type: 'nvarchar', length: 255 })
  remoteJid: string;

  @Column({ type: 'nvarchar', length: 255, nullable: true })
  contactName: string | null;

  @Column({ type: 'uniqueidentifier', nullable: true })
  contactId: string | null;

  @ManyToOne(() => Contact, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'contactId', referencedColumnName: 'id' })
  contact: Contact | null;

  @Column({ type: 'nvarchar', length: 20, default: 'waiting' })
  attendanceStatus: 'waiting' | 'in_progress' | 'finished' = 'waiting';

  @Column({ type: 'uniqueidentifier', nullable: true })
  assignedUserId: string | null = null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'NO ACTION' })
  @JoinColumn({ name: 'assignedUserId', referencedColumnName: 'id' })
  assignedUser: Pick<User, 'id' | 'username'> | null;

  @Column({ type: 'datetime2', nullable: true })
  attendanceStartedAt: Date | null = null;

  @Column({ type: 'datetime2', nullable: true })
  attendanceFinishedAt: Date | null = null;

  @Column({ type: 'datetime2', nullable: true })
  lastMessageAt: Date | null;

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
}
