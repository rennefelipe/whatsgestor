import { ConflictException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import type { UserProfile } from './user-profile';
import { USER_ROLES } from './user-profile';

/** Additive SQL fields are deliberately outside the legacy ORM mapping.
 * No select/insert can reference an absent column before an approved migration.
 * All writes use the caller's transaction and positional SQL parameters.
 */
@Injectable()
export class UsersProfileStore {
  constructor(private readonly source: DataSource) {}

  async available(manager?: EntityManager): Promise<boolean> {
    const rows = await (manager ?? this.source).query(`SELECT COUNT(*) AS [profileColumnCount]
      FROM sys.columns WHERE object_id = OBJECT_ID(N'dbo.users')
      AND name IN (N'fullName', N'email', N'role')`);
    const count = Number(rows[0]?.profileColumnCount);
    if (count === 0) return false;
    if (count !== 3) throw new ServiceUnavailableException('Esquema de usuários incompleto. Solicite revisão administrativa.');
    return true;
  }

  async read(ids: string[], manager?: EntityManager): Promise<Map<string, UserProfile & { updatedAt: Date }>> {
    const executor = manager ?? this.source;
    if (!ids.length || !await this.available(manager)) return new Map();
    const rows = await executor.query(`SELECT [id], [fullName], [email], [role], [updatedAt]
      FROM [dbo].[users] WHERE [id] IN (${ids.map((_, index) => `@${index}`).join(',')})`, ids);
    const profiles = new Map<string, UserProfile & { updatedAt: Date }>();
    for (const row of rows) {
      if (!USER_ROLES.includes(row.role)) throw new ServiceUnavailableException('Perfil de usuário inválido. Solicite revisão administrativa.');
      profiles.set(row.id.toLowerCase(), { fullName: row.fullName, email: row.email, role: row.role, updatedAt: new Date(row.updatedAt) });
    }
    // Missing profiles cannot silently become operational accounts.
    if (profiles.size !== new Set(ids.map((id) => id.toLowerCase())).size) throw new ServiceUnavailableException('Perfil de usuário indisponível.');
    return profiles;
  }

  async requireAvailable(manager?: EntityManager): Promise<void> {
    if (!await this.available(manager)) throw new ConflictException('Nome, e-mail e novos perfis dependem da migration de usuários aprovada.');
  }

  async write(id: string, profile: UserProfile, permissions: { isAdmin: boolean; canDelete: boolean }, manager: EntityManager): Promise<void> {
    await manager.query(`UPDATE [dbo].[users] SET [fullName]=@0, [email]=@1, [role]=@2,
      [isAdmin]=@3, [canDelete]=@4, [updatedAt]=SYSUTCDATETIME() WHERE [id]=@5`,
      [profile.fullName, profile.email, profile.role, permissions.isAdmin, permissions.canDelete, id]);
  }
}
