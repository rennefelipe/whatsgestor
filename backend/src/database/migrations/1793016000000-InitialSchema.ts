import type { MigrationInterface,QueryRunner } from 'typeorm';
import { SQL_V1,TABLES_V1 } from './schema-v1';

/** Only an empty installation. Never infer that an existing database is safe. */
export class InitialSchema1793016000000 implements MigrationInterface {
  async up(runner:QueryRunner):Promise<void>{
    for(const name of TABLES_V1)if(await runner.hasTable('dbo.'+name))throw new Error('BASELINE_REQUIRES_EMPTY_DATABASE');
    for(const sql of SQL_V1)await runner.query(sql);
  }
  async down():Promise<void>{throw new Error('AUTOMATIC_DESTRUCTIVE_ROLLBACK_DISABLED_USE_REVIEWED_RESTORE');}
}
