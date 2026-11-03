import type { MigrationInterface, QueryRunner } from 'typeorm';

export class UserProfiles1793275200000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    if (!await runner.hasTable('dbo.users')) throw new Error('USER_PROFILES_REQUIRES_USERS');
    for (const name of ['fullName', 'email', 'role']) {
      if (await runner.hasColumn('dbo.users', name)) throw new Error('USER_PROFILES_COLUMNS_ALREADY_EXIST_REQUIRES_REVIEW');
    }
    // Raw DDL/backfill intentionally avoids username, passwordHash and updatedAt.
    // Active JWT revisions and existing logins therefore remain unchanged.
    await runner.query(`ALTER TABLE [dbo].[users] ADD [fullName] nvarchar(200) NULL, [email] nvarchar(254) NULL, [role] nvarchar(20) NULL`);
    await runner.query(`UPDATE [dbo].[users] SET [role]=CASE WHEN [isAdmin]=1 THEN N'administrator' ELSE N'attendant' END`);
    if (await runner.hasTable('dbo.users_profile_v2_rollback')) {
      await runner.query(`UPDATE u SET [fullName]=a.[fullName], [email]=a.[email],
        [role]=CASE WHEN u.[isAdmin]=1 THEN N'administrator' ELSE N'attendant' END
        FROM [dbo].[users] u JOIN [dbo].[users_profile_v2_rollback] a ON a.[userId]=u.[id]`);
    }
    await runner.query(`ALTER TABLE [dbo].[users] ALTER COLUMN [role] nvarchar(20) NOT NULL`);
    // Default preserves compatibility with the pre-existing administrator bootstrap.
    // The application derives legacy administrator/attendant from isAdmin. Only
    // tester is an independent role, always paired with both permission bits off.
    await runner.query(`ALTER TABLE [dbo].[users] ADD CONSTRAINT [DF_users_role_v2] DEFAULT N'attendant' FOR [role]`);
    await runner.query(`ALTER TABLE [dbo].[users] WITH CHECK ADD CONSTRAINT [CK_users_role_v2]
      CHECK ([role] IN (N'administrator',N'attendant',N'tester')
        AND ([role]<>N'tester' OR ([isAdmin]=0 AND [canDelete]=0))
        AND ([role]<>N'administrator' OR [isAdmin]=1))`);
  }

  async down(runner: QueryRunner): Promise<void> {
    // Downgrading a tester into a legacy attendant would grant write access.
    await runner.query(`IF EXISTS (SELECT 1 FROM [dbo].[users] WITH (TABLOCKX,HOLDLOCK) WHERE [role]=N'tester')
      THROW 51000, N'USER_PROFILES_ROLLBACK_REQUIRES_TESTER_RECLASSIFICATION', 1`);
    if (!await runner.hasTable('dbo.users_profile_v2_rollback')) {
      await runner.query(`CREATE TABLE [dbo].[users_profile_v2_rollback] (
        [userId] uniqueidentifier NOT NULL PRIMARY KEY, [fullName] nvarchar(200) NULL,
        [email] nvarchar(254) NULL, [role] nvarchar(20) NOT NULL,
        [archivedAt] datetime2(7) NOT NULL DEFAULT SYSUTCDATETIME())`);
    }
    await runner.query(`UPDATE a SET [fullName]=u.[fullName], [email]=u.[email], [role]=u.[role], [archivedAt]=SYSUTCDATETIME()
      FROM [dbo].[users_profile_v2_rollback] a JOIN [dbo].[users] u ON u.[id]=a.[userId]`);
    await runner.query(`INSERT INTO [dbo].[users_profile_v2_rollback] ([userId],[fullName],[email],[role])
      SELECT u.[id],u.[fullName],u.[email],u.[role] FROM [dbo].[users] u
      WHERE NOT EXISTS (SELECT 1 FROM [dbo].[users_profile_v2_rollback] a WHERE a.[userId]=u.[id])`);
    await runner.query(`ALTER TABLE [dbo].[users] DROP CONSTRAINT [CK_users_role_v2], [DF_users_role_v2]`);
    await runner.query(`ALTER TABLE [dbo].[users] DROP COLUMN [fullName], [email], [role]`);
  }
}
