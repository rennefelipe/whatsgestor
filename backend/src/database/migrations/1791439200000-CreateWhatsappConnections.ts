import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateWhatsappConnections1791439200000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE [whatsapp_connections] (
        [id] uniqueidentifier NOT NULL CONSTRAINT [DF_whatsapp_connections_id] DEFAULT NEWID(),
        [name] nvarchar(150) NOT NULL,
        [phoneNumber] nvarchar(30) NULL,
        [status] nvarchar(30) NOT NULL CONSTRAINT [DF_whatsapp_connections_status] DEFAULT (N'disconnected'),
        [isActive] bit NOT NULL CONSTRAINT [DF_whatsapp_connections_isActive] DEFAULT (1),
        [createdAt] datetime2 NOT NULL CONSTRAINT [DF_whatsapp_connections_createdAt] DEFAULT SYSUTCDATETIME(),
        [updatedAt] datetime2 NOT NULL CONSTRAINT [DF_whatsapp_connections_updatedAt] DEFAULT SYSUTCDATETIME(),
        [lastConnectedAt] datetime2 NULL,
        [lastDisconnectedAt] datetime2 NULL,
        CONSTRAINT [PK_whatsapp_connections] PRIMARY KEY ([id])
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE [whatsapp_connections]');
  }
}
