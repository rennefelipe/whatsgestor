import type { MigrationInterface, QueryRunner } from 'typeorm';
import { RECIPIENT_SQL, RECIPIENT_TABLES } from './schema-recipient-selections';

/** Additive only: no changes to connections, conversations, messages or contacts. */
export class RecipientSelections1793390400000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    if (!await runner.hasTable('dbo.users')) throw new Error('RECIPIENT_SCHEMA_REQUIRES_BASELINE');
    for (const table of RECIPIENT_TABLES) {
      if (await runner.hasTable('dbo.' + table)) throw new Error('RECIPIENT_SCHEMA_ALREADY_EXISTS_REQUIRES_REVIEW');
    }
    for (const sql of RECIPIENT_SQL) await runner.query(sql);
  }
  async down(): Promise<void> {
    throw new Error('AUTOMATIC_DESTRUCTIVE_ROLLBACK_DISABLED_USE_REVIEWED_RESTORE');
  }
}
