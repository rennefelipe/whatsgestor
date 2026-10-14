import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateContactStructure1791406993032 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE [contact_types] (
        [id] uniqueidentifier NOT NULL CONSTRAINT [DF_contact_types_id] DEFAULT NEWID(),
        [name] nvarchar(100) NOT NULL,
        [isActive] bit NOT NULL CONSTRAINT [DF_contact_types_isActive] DEFAULT (1),
        [createdAt] datetime2 NOT NULL CONSTRAINT [DF_contact_types_createdAt] DEFAULT SYSUTCDATETIME(),
        [updatedAt] datetime2 NOT NULL CONSTRAINT [DF_contact_types_updatedAt] DEFAULT SYSUTCDATETIME(),
        CONSTRAINT [PK_contact_types] PRIMARY KEY ([id])
      )
    `);

    await queryRunner.query(`
      CREATE TABLE [contacts] (
        [id] uniqueidentifier NOT NULL CONSTRAINT [DF_contacts_id] DEFAULT NEWID(),
        [organizationId] uniqueidentifier NULL,
        [contactTypeId] uniqueidentifier NOT NULL,
        [storeName] nvarchar(150) NULL,
        [contactName] nvarchar(150) NOT NULL,
        [phone] nvarchar(30) NOT NULL,
        [email] nvarchar(200) NULL,
        [isActive] bit NOT NULL CONSTRAINT [DF_contacts_isActive] DEFAULT (1),
        [createdAt] datetime2 NOT NULL CONSTRAINT [DF_contacts_createdAt] DEFAULT SYSUTCDATETIME(),
        [updatedAt] datetime2 NOT NULL CONSTRAINT [DF_contacts_updatedAt] DEFAULT SYSUTCDATETIME(),
        CONSTRAINT [PK_contacts] PRIMARY KEY ([id]),
        CONSTRAINT [FK_contacts_organizationId]
          FOREIGN KEY ([organizationId]) REFERENCES [organizations]([id])
          ON DELETE NO ACTION,
        CONSTRAINT [FK_contacts_contactTypeId]
          FOREIGN KEY ([contactTypeId]) REFERENCES [contact_types]([id])
          ON DELETE NO ACTION
      )
    `);

    await queryRunner.query(
      'CREATE INDEX [IX_contacts_organizationId] ON [contacts] ([organizationId])',
    );
    await queryRunner.query(
      'CREATE INDEX [IX_contacts_contactTypeId] ON [contacts] ([contactTypeId])',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE [contacts]');
    await queryRunner.query('DROP TABLE [contact_types]');
  }
}
