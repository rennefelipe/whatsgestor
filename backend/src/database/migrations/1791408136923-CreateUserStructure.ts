import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateUserStructure1791408136923 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE [users] (
        [id] uniqueidentifier NOT NULL CONSTRAINT [DF_users_id] DEFAULT NEWID(),
        [username] nvarchar(100) NOT NULL,
        [passwordHash] nvarchar(255) NOT NULL,
        [isAdmin] bit NOT NULL CONSTRAINT [DF_users_isAdmin] DEFAULT (0),
        [canDelete] bit NOT NULL CONSTRAINT [DF_users_canDelete] DEFAULT (0),
        [isActive] bit NOT NULL CONSTRAINT [DF_users_isActive] DEFAULT (1),
        [createdAt] datetime2 NOT NULL CONSTRAINT [DF_users_createdAt] DEFAULT SYSUTCDATETIME(),
        [updatedAt] datetime2 NOT NULL CONSTRAINT [DF_users_updatedAt] DEFAULT SYSUTCDATETIME(),
        CONSTRAINT [PK_users] PRIMARY KEY ([id])
      )
    `);

    await queryRunner.query(
      'CREATE UNIQUE INDEX [UQ_users_username] ON [users] ([username])',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE [users]');
  }
}
