import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWhatsappMessageMedia1791600000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE [whatsapp_message_media] (
      [id] uniqueidentifier NOT NULL CONSTRAINT [DF_whatsapp_message_media_id] DEFAULT NEWID(),
      [messageId] uniqueidentifier NOT NULL,
      [kind] nvarchar(20) NOT NULL,
      [availability] nvarchar(20) NOT NULL CONSTRAINT [DF_whatsapp_message_media_availability] DEFAULT N'pending',
      [mimeType] nvarchar(100) NOT NULL,
      [originalName] nvarchar(255) NULL,
      [sizeBytes] int NULL,
      [durationSeconds] int NULL,
      [storageKey] nvarchar(64) NULL,
      [createdAt] datetime2 NOT NULL CONSTRAINT [DF_whatsapp_message_media_createdAt] DEFAULT SYSUTCDATETIME(),
      [updatedAt] datetime2 NOT NULL CONSTRAINT [DF_whatsapp_message_media_updatedAt] DEFAULT SYSUTCDATETIME(),
      CONSTRAINT [PK_whatsapp_message_media] PRIMARY KEY ([id]),
      CONSTRAINT [FK_whatsapp_message_media_messageId] FOREIGN KEY ([messageId]) REFERENCES [whatsapp_messages]([id]) ON DELETE NO ACTION,
      CONSTRAINT [CK_whatsapp_message_media_kind] CHECK ([kind] IN (N'image',N'document',N'audio')),
      CONSTRAINT [CK_whatsapp_message_media_availability] CHECK ([availability] IN (N'pending',N'ready',N'failed')),
      CONSTRAINT [CK_whatsapp_message_media_size] CHECK ([sizeBytes] IS NULL OR [sizeBytes] BETWEEN 1 AND 20971520),
      CONSTRAINT [CK_whatsapp_message_media_duration] CHECK ([durationSeconds] IS NULL OR [durationSeconds] >= 0)
    )`);
    await queryRunner.query(
      'CREATE UNIQUE INDEX [UQ_whatsapp_message_media_messageId] ON [whatsapp_message_media] ([messageId])',
    );
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE [whatsapp_message_media]');
  }
}
