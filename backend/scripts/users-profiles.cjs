// Explicit, scoped maintenance entry point. Never run at application startup.
const { args, target } = require('./database.cjs');
const { migrationDataSource } = require('../dist/database/data-source');
const { UserProfiles1793275200000 } = require('../dist/database/migrations/1793275200000-UserProfiles');
const { MigrationExecutor, Migration } = require('typeorm');
const name = 'UserProfiles1793275200000';

async function inspect(source, runner) {
  if (!await runner.hasTable('dbo.users')) throw Error('USER_PROFILES_REQUIRES_USERS');
  const columns = await runner.query(`SELECT c.name, t.name AS [type], c.max_length AS [length], c.is_nullable AS [nullable]
    FROM sys.columns c JOIN sys.types t ON c.user_type_id=t.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.users')`);
  for (const [column, type, length] of [
    ['id', 'uniqueidentifier', 16], ['username', 'nvarchar', 200], ['passwordHash', 'nvarchar', 510],
    ['isAdmin', 'bit', 1], ['canDelete', 'bit', 1], ['isActive', 'bit', 1],
    ['createdAt', 'datetime2', 8], ['updatedAt', 'datetime2', 8],
  ]) {
    if (!columns.some(c => c.name === column && c.type === type && Number(c.length) === length && !c.nullable)) throw Error('USER_PROFILES_BASE_SCHEMA_MISMATCH');
  }
  const history = await runner.hasTable('dbo.whatsgestor_migrations')
    ? await runner.query('SELECT [id], [timestamp], [name] FROM [dbo].[whatsgestor_migrations] ORDER BY [id]') : [];
  const known = source.migrations.map(m => m.name ?? m.constructor.name);
  if (history.some(row => !known.includes(row.name))) throw Error('UNKNOWN_MIGRATION_HISTORY_REQUIRES_REVIEW');
  const profileColumns = columns.filter(c => ['fullName', 'email', 'role'].includes(c.name));
  const applied = history.some(row => row.name === name);
  if (applied ? profileColumns.length !== 3 : profileColumns.length !== 0) throw Error('USER_PROFILES_SCHEMA_HISTORY_MISMATCH');
  return { applied, lastMigration: history.at(-1)?.name ?? null, legacyHistoryAbsent: history.length === 0,
    scope: name, baselineWillNotRun: true };
}

async function main(argv = process.argv.slice(2)) {
  const options = args(argv);
  if (!['plan', 'migrate', 'revert'].includes(options.action)) throw Error('USER_PROFILES_ACTION_INVALID');
  if (options.action !== 'plan' && (!options.apply || !options['maintenance-approved'])) throw Error('USER_PROFILES_EXPLICIT_MAINTENANCE_APPROVAL_REQUIRED');
  const values = target({ ...options, action: options.action === 'plan' ? 'plan' : 'migrate' });
  const source = migrationDataSource(values);
  let runner;
  try {
    await source.initialize(); runner = source.createQueryRunner(); await runner.connect();
    const actual = await runner.query('SELECT DB_NAME() AS [name]');
    if (actual[0]?.name !== options.database) throw Error('CONNECTED_DATABASE_MISMATCH');
    if (options.action === 'plan') { console.log(JSON.stringify({ mode: 'read-only', ...await inspect(source, runner) })); return; }
    await runner.startTransaction('SERIALIZABLE');
    try {
      await runner.query("SET LOCK_TIMEOUT 10000; DECLARE @r int; EXEC @r=sys.sp_getapplock @Resource=N'WhatsGestor.release',@LockMode=N'Exclusive',@LockOwner=N'Transaction',@LockTimeout=0; IF @r<0 THROW 51000,N'MAINTENANCE_ALREADY_RUNNING',1;");
      const state = await inspect(source, runner);
      const executor = new MigrationExecutor(source, runner);
      const migration = new Migration(undefined, 1793275200000, name, new UserProfiles1793275200000());
      if (options.action === 'migrate') {
        if (state.applied) throw Error('USER_PROFILES_ALREADY_APPLIED');
        await executor.executeMigration(migration);
      } else {
        if (!state.applied || state.lastMigration !== name) throw Error('USER_PROFILES_NOT_LATEST_MIGRATION');
        await migration.instance.down(runner);
        await executor.deleteMigration(migration);
      }
      await runner.commitTransaction();
      console.log(JSON.stringify({ scope: name, action: options.action, baselineExecuted: false }));
    } catch (error) {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      throw error;
    }
  } finally {
    if (runner) await runner.release();
    if (source.isInitialized) await source.destroy();
  }
}
module.exports = { inspect, main };
if (require.main === module) void main().catch(error => {
  console.error(typeof error.message === 'string' && /^[A-Z][A-Z0-9_]+$/.test(error.message) ? error.message : 'USER_PROFILES_MAINTENANCE_FAILED');
  process.exitCode = 1;
});
