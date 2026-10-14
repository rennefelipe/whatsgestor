import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateWhatsappConversationsAndMessages1791485910429 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE [whatsapp_conversations] (
        [id] uniqueidentifier NOT NULL CONSTRAINT [DF_whatsapp_conversations_id] DEFAULT NEWID(),
        [connectionId] uniqueidentifier NOT NULL,
        [remoteJid] nvarchar(255) NOT NULL,
        [contactName] nvarchar(255) NULL,
        [lastMessageAt] datetime2 NULL,
        [createdAt] datetime2 NOT NULL CONSTRAINT [DF_whatsapp_conversations_createdAt] DEFAULT SYSUTCDATETIME(),
        [updatedAt] datetime2 NOT NULL CONSTRAINT [DF_whatsapp_conversations_updatedAt] DEFAULT SYSUTCDATETIME(),
        CONSTRAINT [PK_whatsapp_conversations] PRIMARY KEY ([id]),
        CONSTRAINT [FK_whatsapp_conversations_connectionId]
          FOREIGN KEY ([connectionId]) REFERENCES [whatsapp_connections]([id])
          ON DELETE NO ACTION
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX [UQ_whatsapp_conversations_connection_remoteJid]
      ON [whatsapp_conversations] ([connectionId], [remoteJid])
    `);

    await queryRunner.query(`
      CREATE TABLE [whatsapp_messages] (
        [id] uniqueidentifier NOT NULL CONSTRAINT [DF_whatsapp_messages_id] DEFAULT NEWID(),
        [conversationId] uniqueidentifier NOT NULL,
        [whatsappMessageId] nvarchar(255) NOT NULL,
        [fromMe] bit NOT NULL,
        [messageType] nvarchar(50) NOT NULL CONSTRAINT [DF_whatsapp_messages_messageType] DEFAULT (N'text'),
        [textContent] nvarchar(max) NULL,
        [messageTimestamp] datetime2 NULL,
        [status] nvarchar(30) NOT NULL CONSTRAINT [DF_whatsapp_messages_status] DEFAULT (N'received'),
        [createdAt] datetime2 NOT NULL CONSTRAINT [DF_whatsapp_messages_createdAt] DEFAULT SYSUTCDATETIME(),
        [updatedAt] datetime2 NOT NULL CONSTRAINT [DF_whatsapp_messages_updatedAt] DEFAULT SYSUTCDATETIME(),
        CONSTRAINT [PK_whatsapp_messages] PRIMARY KEY ([id]),
        CONSTRAINT [FK_whatsapp_messages_conversationId]
          FOREIGN KEY ([conversationId]) REFERENCES [whatsapp_conversations]([id])
          ON DELETE NO ACTION
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX [UQ_whatsapp_messages_conversation_message_fromMe]
      ON [whatsapp_messages] ([conversationId], [whatsappMessageId], [fromMe])
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE [whatsapp_messages]');
    await queryRunner.query('DROP TABLE [whatsapp_conversations]');
  }
}
