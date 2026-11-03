import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';

@Entity({ name: 'recipient_selections', schema: 'dbo' })
@Index('IX_recipient_selections_owner', ['ownerId', 'updatedAt', 'id'])
@Index('UQ_recipient_selections_slot', ['ownerId', 'slot'], {
  unique: true,
  where: '[slot] IS NOT NULL',
})
@Check(
  'CK_recipient_selections_retention',
  '([retained]=1 AND [expiresAt] IS NULL) OR ([retained]=0 AND [expiresAt] IS NOT NULL)',
)
@Check(
  'CK_recipient_selections_version',
  '[version]>=0 AND ([slot] IS NULL OR [slot] BETWEEN 0 AND 2) AND ([retained]=0 OR [slot] IS NULL)',
)
export class RecipientSelection {
  @PrimaryColumn('uniqueidentifier') id!: string;
  @Column('uniqueidentifier') ownerId!: string;
  @Column({ type: 'uniqueidentifier', nullable: true }) currentRevisionId!:
    string | null;
  @Column({ type: 'uniqueidentifier', nullable: true }) activeOperationId!:
    string | null;
  @Column({ type: 'uniqueidentifier', nullable: true }) lastOperationId!:
    string | null;
  @Column({ type: 'int', default: 0 }) version!: number;
  @Column({ type: 'bit', default: false }) retained!: boolean;
  @Column({ type: 'int', nullable: true }) slot!: number | null;
  @Column({ type: 'datetime2', nullable: true }) expiresAt!: Date | null;
  @CreateDateColumn({ type: 'datetime2', default: () => 'SYSUTCDATETIME()' })
  createdAt!: Date;
  @Column('datetime2') updatedAt!: Date;
}
@Entity({ name: 'recipient_selection_revisions', schema: 'dbo' })
@Index('IX_recipient_revisions_selection', ['selectionId', 'version'])
@Index('UQ_recipient_revisions_published', ['selectionId', 'version'], {
  unique: true,
  where: "[status] = N'ready'",
})
@Check(
  'CK_recipient_revisions_status',
  "[status] IN (N'building',N'ready',N'failed') AND [version]>0",
)
export class RecipientSelectionRevision {
  @PrimaryColumn('uniqueidentifier') id!: string;
  @Column('uniqueidentifier') selectionId!: string;
  @ManyToOne(() => RecipientSelection, {
    onDelete: 'NO ACTION',
    nullable: false,
  })
  @JoinColumn({
    name: 'selectionId',
    foreignKeyConstraintName: 'FK_recipient_revisions_selection',
  })
  selection?: RecipientSelection;
  @Column('int') version!: number;
  @Column({ type: 'nvarchar', length: 12 }) status!:
    'building' | 'ready' | 'failed';
  @Column({ type: 'nvarchar', length: 'MAX' }) metadata!: string;
  @Column({ type: 'nvarchar', length: 50 }) normalizationVersion!: string;
  @CreateDateColumn({ type: 'datetime2', default: () => 'SYSUTCDATETIME()' })
  createdAt!: Date;
}
@Entity({ name: 'recipient_selection_items', schema: 'dbo' })
@Index('UQ_recipient_items_context', ['revisionId', 'contextKey', 'selected'], {
  unique: true,
})
@Index('UQ_recipient_items_ordinal', ['revisionId', 'ordinal'], {
  unique: true,
})
export class RecipientSelectionItem {
  @PrimaryColumn('uniqueidentifier') id!: string;
  @Column('uniqueidentifier') revisionId!: string;
  @ManyToOne(() => RecipientSelectionRevision, {
    onDelete: 'NO ACTION',
    nullable: false,
  })
  @JoinColumn({
    name: 'revisionId',
    foreignKeyConstraintName: 'FK_recipient_items_revision',
  })
  revision?: RecipientSelectionRevision;
  @Column({
    type: 'nvarchar',
    length: 64,
    collation: 'Latin1_General_100_BIN2',
  })
  contextKey!: string;
  @Column('int') ordinal!: number;
  @Column('bit') selected!: boolean;
  @Column('bit') inQuery!: boolean;
  @Column({ type: 'nvarchar', length: 'MAX' }) snapshot!: string;
}
@Entity({ name: 'recipient_selection_sources', schema: 'dbo' })
@Index('UQ_recipient_sources_contact', ['itemId', 'contactId'], {
  unique: true,
})
@Index('IX_recipient_sources_revision', ['revisionId', 'id'])
export class RecipientSelectionSource {
  @PrimaryColumn('uniqueidentifier') id!: string;
  @Column('uniqueidentifier') revisionId!: string;
  @ManyToOne(() => RecipientSelectionRevision, {
    onDelete: 'NO ACTION',
    nullable: false,
  })
  @JoinColumn({
    name: 'revisionId',
    foreignKeyConstraintName: 'FK_recipient_sources_revision',
  })
  revision?: RecipientSelectionRevision;
  @Column('uniqueidentifier') itemId!: string;
  @ManyToOne(() => RecipientSelectionItem, {
    onDelete: 'NO ACTION',
    nullable: false,
  })
  @JoinColumn({
    name: 'itemId',
    foreignKeyConstraintName: 'FK_recipient_sources_item',
  })
  item?: RecipientSelectionItem;
  // Historical identifiers intentionally have no FK to mutable Contacts.
  @Column('uniqueidentifier') contactId!: string;
  @Column({ type: 'nvarchar', length: 'MAX' }) snapshot!: string;
}
@Entity({ name: 'recipient_selection_operations', schema: 'dbo' })
@Index('UQ_recipient_operations_request', ['ownerId', 'requestId'], {
  unique: true,
})
@Index('IX_recipient_operations_selection', ['selectionId', 'createdAt'])
@Check(
  'CK_recipient_operations_status',
  "[status] IN (N'building',N'completed',N'failed') AND [processed]>=0 AND [total]>=0 AND [processed]<=[total] AND [attempt]>0",
)
export class RecipientSelectionOperation {
  @PrimaryColumn('uniqueidentifier') id!: string;
  @Column('uniqueidentifier') selectionId!: string;
  @ManyToOne(() => RecipientSelection, {
    onDelete: 'NO ACTION',
    nullable: false,
  })
  @JoinColumn({
    name: 'selectionId',
    foreignKeyConstraintName: 'FK_recipient_operations_selection',
  })
  selection?: RecipientSelection;
  @Column('uniqueidentifier') ownerId!: string;
  @Column('uniqueidentifier') requestId!: string;
  @Column('uniqueidentifier') revisionId!: string;
  @ManyToOne(() => RecipientSelectionRevision, {
    onDelete: 'NO ACTION',
    nullable: false,
  })
  @JoinColumn({
    name: 'revisionId',
    foreignKeyConstraintName: 'FK_recipient_operations_revision',
  })
  revision?: RecipientSelectionRevision;
  @Column('uniqueidentifier') leaseToken!: string;
  @Column('datetime2') leaseExpiresAt!: Date;
  @Column('int') baseVersion!: number;
  @Column('int') attempt!: number;
  @Column({ type: 'nvarchar', length: 12 }) status!:
    'building' | 'completed' | 'failed';
  @Column({ type: 'nvarchar', length: 'MAX' }) input!: string;
  @Column({ type: 'nvarchar', length: 'MAX' }) errors!: string;
  @Column('int') processed!: number;
  @Column('int') total!: number;
  @CreateDateColumn({ type: 'datetime2', default: () => 'SYSUTCDATETIME()' })
  createdAt!: Date;
  @Column('datetime2') updatedAt!: Date;
}
export const recipientSelectionEntities = [
  RecipientSelection,
  RecipientSelectionRevision,
  RecipientSelectionItem,
  RecipientSelectionSource,
  RecipientSelectionOperation,
];
