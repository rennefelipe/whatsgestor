import { MigrationInterface, QueryRunner } from 'typeorm';

export class LinkWhatsappConversationsToContacts1791493160976 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE [whatsapp_conversations]
      ADD [contactId] uniqueidentifier NULL
    `);
    await queryRunner.query(`
      CREATE INDEX [IX_whatsapp_conversations_contactId]
      ON [whatsapp_conversations] ([contactId])
    `);
    await queryRunner.query(`
      ALTER TABLE [whatsapp_conversations]
      ADD CONSTRAINT [FK_whatsapp_conversations_contactId]
      FOREIGN KEY ([contactId]) REFERENCES [contacts]([id])
      ON DELETE SET NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE [whatsapp_conversations]
      DROP CONSTRAINT [FK_whatsapp_conversations_contactId]
    `);
    await queryRunner.query(`
      DROP INDEX [IX_whatsapp_conversations_contactId]
      ON [whatsapp_conversations]
    `);
    await queryRunner.query(`
      ALTER TABLE [whatsapp_conversations]
      DROP COLUMN [contactId]
    `);
  }
}
