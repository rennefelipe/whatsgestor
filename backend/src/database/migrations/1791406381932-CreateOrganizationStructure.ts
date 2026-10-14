import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateOrganizationStructure1791406381932 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE [organization_types] (
        [id] uniqueidentifier NOT NULL CONSTRAINT [DF_organization_types_id] DEFAULT NEWID(),
        [name] nvarchar(100) NOT NULL,
        [isActive] bit NOT NULL CONSTRAINT [DF_organization_types_isActive] DEFAULT (1),
        [createdAt] datetime2 NOT NULL CONSTRAINT [DF_organization_types_createdAt] DEFAULT SYSUTCDATETIME(),
        [updatedAt] datetime2 NOT NULL CONSTRAINT [DF_organization_types_updatedAt] DEFAULT SYSUTCDATETIME(),
        CONSTRAINT [PK_organization_types] PRIMARY KEY ([id])
      )
    `);

    await queryRunner.query(`
      CREATE TABLE [organizations] (
        [id] uniqueidentifier NOT NULL CONSTRAINT [DF_organizations_id] DEFAULT NEWID(),
        [name] nvarchar(150) NOT NULL,
        [organizationTypeId] uniqueidentifier NOT NULL,
        [parentOrganizationId] uniqueidentifier NULL,
        [isActive] bit NOT NULL CONSTRAINT [DF_organizations_isActive] DEFAULT (1),
        [createdAt] datetime2 NOT NULL CONSTRAINT [DF_organizations_createdAt] DEFAULT SYSUTCDATETIME(),
        [updatedAt] datetime2 NOT NULL CONSTRAINT [DF_organizations_updatedAt] DEFAULT SYSUTCDATETIME(),
        CONSTRAINT [PK_organizations] PRIMARY KEY ([id]),
        CONSTRAINT [FK_organizations_organizationTypeId]
          FOREIGN KEY ([organizationTypeId]) REFERENCES [organization_types]([id])
          ON DELETE NO ACTION,
        CONSTRAINT [FK_organizations_parentOrganizationId]
          FOREIGN KEY ([parentOrganizationId]) REFERENCES [organizations]([id])
          ON DELETE NO ACTION
      )
    `);

    await queryRunner.query(
      'CREATE INDEX [IX_organizations_organizationTypeId] ON [organizations] ([organizationTypeId])',
    );
    await queryRunner.query(
      'CREATE INDEX [IX_organizations_parentOrganizationId] ON [organizations] ([parentOrganizationId])',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE [organizations]');
    await queryRunner.query('DROP TABLE [organization_types]');
  }
}
