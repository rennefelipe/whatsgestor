import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Index,
  ManyToOne,
  JoinColumn,
  Check,
} from 'typeorm';
import { Organization } from '../../organizations/entities/organization.entity';

@Entity({ name: 'contact_campaign_preferences', schema: 'dbo' })
@Check(
  'CK_campaign_preferences_target',
  `
  ([normalizedPhone] IS NOT NULL AND [whatsappIdentity] IS NULL AND [connectionId] IS NULL AND [evidenceConversationId] IS NULL
    AND LEFT([normalizedPhone],1) = N'+' AND LEN([normalizedPhone]) BETWEEN 8 AND 16 AND SUBSTRING([normalizedPhone],2,16) NOT LIKE N'%[^0-9]%') OR
  ([normalizedPhone] IS NULL AND [whatsappIdentity] IS NOT NULL AND [connectionId] IS NOT NULL AND [evidenceConversationId] IS NOT NULL AND [whatsappIdentity] LIKE N'%@lid')`,
)
@Check(
  'CK_campaign_preferences_state',
  `[version] >= 1 AND LEN(LTRIM(RTRIM([reason]))) >= 3 AND
  (([isActive] = 1 AND [revokedAt] IS NULL) OR ([isActive] = 0 AND [revokedAt] IS NOT NULL))`,
)
@Index('UQ_campaign_preferences_phone_global', ['normalizedPhone'], {
  unique: true,
  where:
    '[isActive] = 1 AND [normalizedPhone] IS NOT NULL AND [shoppingId] IS NULL',
})
@Index(
  'UQ_campaign_preferences_phone_shopping',
  ['normalizedPhone', 'shoppingId'],
  {
    unique: true,
    where:
      '[isActive] = 1 AND [normalizedPhone] IS NOT NULL AND [shoppingId] IS NOT NULL',
  },
)
@Index(
  'UQ_campaign_preferences_identity_global',
  ['connectionId', 'whatsappIdentity'],
  {
    unique: true,
    where:
      '[isActive] = 1 AND [whatsappIdentity] IS NOT NULL AND [shoppingId] IS NULL',
  },
)
@Index(
  'UQ_campaign_preferences_identity_shopping',
  ['connectionId', 'whatsappIdentity', 'shoppingId'],
  {
    unique: true,
    where:
      '[isActive] = 1 AND [whatsappIdentity] IS NOT NULL AND [shoppingId] IS NOT NULL',
  },
)
export class ContactCampaignPreference {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({
    type: 'nvarchar',
    length: 16,
    nullable: true,
    collation: 'Latin1_General_100_BIN2',
  })
  normalizedPhone!: string | null;
  @Column({
    type: 'nvarchar',
    length: 255,
    nullable: true,
    collation: 'Latin1_General_100_BIN2',
  })
  whatsappIdentity!: string | null;
  @Column({ type: 'uniqueidentifier', nullable: true }) connectionId!:
    string | null;
  @Column({ type: 'uniqueidentifier', nullable: true }) evidenceConversationId!:
    string | null;
  @Column({ type: 'uniqueidentifier', nullable: true }) sourceContactId!:
    string | null;
  @Column({ type: 'uniqueidentifier', nullable: true }) shoppingId!:
    string | null;
  @ManyToOne(() => Organization, { nullable: true, onDelete: 'NO ACTION' })
  @JoinColumn({
    name: 'shoppingId',
    foreignKeyConstraintName: 'FK_campaign_preferences_shopping',
  })
  shopping?: Organization | null;
  @Column({ type: 'bit', default: true }) isActive!: boolean;
  @Column({ type: 'int', default: 1 }) version!: number;
  @Column({ type: 'nvarchar', length: 500 }) reason!: string;
  @Column({ type: 'uniqueidentifier' }) createdBy!: string;
  @CreateDateColumn({ type: 'datetime2', precision: 7, default: () => 'SYSUTCDATETIME()' })
  createdAt!: Date;
  @Column({ type: 'datetime2', precision: 7, nullable: true }) revokedAt!: Date | null;
}

@Entity({ name: 'contact_campaign_preference_events', schema: 'dbo' })
@Check(
  'CK_campaign_preference_events_action',
  "[action] IN (N'block',N'revoke') AND [preferenceVersion] >= 1 AND LEN(LTRIM(RTRIM([reason]))) >= 3",
)
@Index(
  'UQ_campaign_preference_events_version',
  ['preferenceId', 'preferenceVersion'],
  { unique: true },
)
@Index('IX_campaign_preference_events_history', [
  'preferenceId',
  'createdAt',
  'id',
])
export class ContactCampaignPreferenceEvent {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'uniqueidentifier' }) preferenceId!: string;
  @ManyToOne(() => ContactCampaignPreference, {
    nullable: false,
    onDelete: 'NO ACTION',
  })
  @JoinColumn({
    name: 'preferenceId',
    foreignKeyConstraintName: 'FK_campaign_preference_events_preference',
  })
  preference?: ContactCampaignPreference;
  @Column({ type: 'int' }) preferenceVersion!: number;
  @Column({ type: 'nvarchar', length: 10 }) action!: 'block' | 'revoke';
  @Column({ type: 'uniqueidentifier' }) actorId!: string;
  @Column({ type: 'nvarchar', length: 100 }) actorUsername!: string;
  @Column({ type: 'nvarchar', length: 500 }) reason!: string;
  @Column({ type: 'nvarchar', length: 'MAX', nullable: true }) beforeState!:
    string | null;
  @Column({ type: 'nvarchar', length: 'MAX' }) afterState!: string;
  @CreateDateColumn({ type: 'datetime2', precision: 7, default: () => 'SYSUTCDATETIME()' })
  createdAt!: Date;
}
