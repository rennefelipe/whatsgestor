import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWhatsappConversationAttendance1791540000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE [whatsapp_conversations] ADD
        [attendanceStatus] nvarchar(20) NOT NULL
          CONSTRAINT [DF_whatsapp_conversations_attendanceStatus] DEFAULT (N'waiting') WITH VALUES,
        [assignedUserId] uniqueidentifier NULL,
        [attendanceStartedAt] datetime2 NULL,
        [attendanceFinishedAt] datetime2 NULL
    `);
    await queryRunner.query(`
      ALTER TABLE [whatsapp_conversations]
      ADD CONSTRAINT [CK_whatsapp_conversations_attendanceStatus]
      CHECK ([attendanceStatus] IN (N'waiting', N'in_progress', N'finished'))
    `);
    await queryRunner.query(`
      ALTER TABLE [whatsapp_conversations]
      ADD CONSTRAINT [FK_whatsapp_conversations_assignedUserId]
      FOREIGN KEY ([assignedUserId]) REFERENCES [users]([id]) ON DELETE NO ACTION
    `);
    await queryRunner.query(`
      CREATE INDEX [IX_whatsapp_conversations_attendanceStatus]
      ON [whatsapp_conversations] ([attendanceStatus])
    `);
    await queryRunner.query(`
      CREATE INDEX [IX_whatsapp_conversations_assignedUserId]
      ON [whatsapp_conversations] ([assignedUserId])
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX [IX_whatsapp_conversations_assignedUserId] ON [whatsapp_conversations]
    `);
    await queryRunner.query(`
      DROP INDEX [IX_whatsapp_conversations_attendanceStatus] ON [whatsapp_conversations]
    `);
    await queryRunner.query(`
      ALTER TABLE [whatsapp_conversations] DROP CONSTRAINT
        [FK_whatsapp_conversations_assignedUserId],
        [CK_whatsapp_conversations_attendanceStatus],
        [DF_whatsapp_conversations_attendanceStatus]
    `);
    await queryRunner.query(`
      ALTER TABLE [whatsapp_conversations] DROP COLUMN
        [attendanceStatus], [assignedUserId], [attendanceStartedAt], [attendanceFinishedAt]
    `);
  }
}
