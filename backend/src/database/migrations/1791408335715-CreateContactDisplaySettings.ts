import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateContactDisplaySettings1791408335715 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE [contact_display_settings] (
        [id] uniqueidentifier NOT NULL CONSTRAINT [DF_contact_display_settings_id] DEFAULT NEWID(),
        [fieldKey] nvarchar(50) NOT NULL,
        [isVisible] bit NOT NULL CONSTRAINT [DF_contact_display_settings_isVisible] DEFAULT (1),
        [displayOrder] int NOT NULL,
        [createdAt] datetime2 NOT NULL CONSTRAINT [DF_contact_display_settings_createdAt] DEFAULT SYSUTCDATETIME(),
        [updatedAt] datetime2 NOT NULL CONSTRAINT [DF_contact_display_settings_updatedAt] DEFAULT SYSUTCDATETIME(),
        CONSTRAINT [PK_contact_display_settings] PRIMARY KEY ([id]),
        CONSTRAINT [UQ_contact_display_settings_fieldKey] UNIQUE ([fieldKey])
      )
    `);

    await queryRunner.query(`
      INSERT INTO [contact_display_settings] ([fieldKey], [isVisible], [displayOrder])
      VALUES
        (N'group', 1, 1),
        (N'shopping', 1, 2),
        (N'store', 1, 3),
        (N'contactType', 1, 4),
        (N'contactName', 1, 5)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE [contact_display_settings]');
  }
}
