const { test } = require('node:test');
const assert = require('node:assert/strict');
const { UserProfiles1793275200000 } = require('../dist/database/migrations/1793275200000-UserProfiles');
const { migrationDataSource } = require('../dist/database/data-source');

// Contract simulator only: no driver connection or SQL server is initialized.
function fixture() {
  const rows = [
    { id: 'admin-fixture', username: 'admin-original', passwordHash: 'opaque-existing-bcrypt', isAdmin: true, canDelete: true, isActive: true, updatedAt: 'original-revision' },
    { id: 'attendant-fixture', username: 'existing-agent', passwordHash: 'other-existing-bcrypt', isAdmin: false, canDelete: false, isActive: false, updatedAt: 'another-revision' },
  ];
  const columns = new Set(), archive = new Map(), queries = [];
  let archiveExists = false;
  return { rows, columns, archive, queries,
    hasTable: async (name) => name === 'dbo.users' || (name === 'dbo.users_profile_v2_rollback' && archiveExists),
    hasColumn: async (_table, name) => columns.has(name),
    query: async (sql) => {
      queries.push(sql);
      if (sql.startsWith('IF EXISTS') && rows.some(row => row.role === 'tester')) throw Error('USER_PROFILES_ROLLBACK_REQUIRES_TESTER_RECLASSIFICATION');
      if (sql.includes(' ADD [fullName]')) {
        for (const name of ['fullName', 'email', 'role']) columns.add(name);
        for (const row of rows) Object.assign(row, { fullName: null, email: null, role: null });
      }
      if (sql.startsWith('UPDATE [dbo].[users] SET [role]')) for (const row of rows) row.role = row.isAdmin ? 'administrator' : 'attendant';
      if (sql.startsWith('UPDATE u SET')) for (const row of rows) {
        const saved = archive.get(row.id);
        if (saved) Object.assign(row, { fullName: saved.fullName, email: saved.email });
      }
      if (sql.startsWith('CREATE TABLE')) archiveExists = true;
      if (sql.startsWith('UPDATE a SET') || sql.startsWith('INSERT INTO')) for (const row of rows) archive.set(row.id, { fullName: row.fullName, email: row.email, role: row.role });
      if (sql.includes(' DROP COLUMN')) {
        columns.clear();
        for (const row of rows) { delete row.fullName; delete row.email; delete row.role; }
      }
      return [];
    },
  };
}

test('additive up and archived down/up preserve all existing identity, credentials, flags and session revisions', async () => {
  const runner = fixture(), original = structuredClone(runner.rows), migration = new UserProfiles1793275200000();
  await migration.up(runner);
  assert.equal(runner.rows[0].role, 'administrator');
  assert.equal(runner.rows[1].role, 'attendant');
  for (const [index, row] of runner.rows.entries()) for (const [key, value] of Object.entries(original[index])) assert.equal(row[key], value);
  runner.rows[0].fullName = 'Administrador Existente'; runner.rows[0].email = 'admin@example.invalid';
  await migration.down(runner);
  assert.deepEqual(runner.rows, original);
  assert.equal(runner.archive.get(original[0].id).fullName, 'Administrador Existente');
  await migration.up(runner);
  assert.equal(runner.rows[0].fullName, 'Administrador Existente');
  assert.equal(runner.rows[0].email, 'admin@example.invalid');
  for (const sql of runner.queries) assert.doesNotMatch(sql, /passwordHash|username|updatedAt|DELETE\s+FROM|TRUNCATE|DROP\s+TABLE/i);
});

test('rollback refuses even an inactive tester before archiving or dropping columns', async () => {
  const runner = fixture(), migration = new UserProfiles1793275200000();
  await migration.up(runner);
  runner.rows[1].role = 'tester'; runner.rows[1].isActive = false;
  const before = runner.queries.length;
  await assert.rejects(() => migration.down(runner), /TESTER_RECLASSIFICATION/);
  assert.equal(runner.queries.length, before + 1);
  assert.equal(runner.columns.size, 3);
  assert.equal(runner.archive.size, 0);
});

test('migration refuses partial/repeated columns and missing users before DDL', async () => {
  const runner = fixture(), migration = new UserProfiles1793275200000();
  runner.columns.add('role');
  await assert.rejects(() => migration.up(runner), /COLUMNS_ALREADY_EXIST/);
  assert.equal(runner.queries.length, 0);
  await assert.rejects(() => migration.up({ hasTable: async () => false }), /REQUIRES_USERS/);
});

test('versioned migration remains explicit and no schema synchronization is enabled', async () => {
  const source = migrationDataSource({ DB_HOST: 'offline.invalid', DB_PORT: '1433', DB_USERNAME: 'fixture', DB_PASSWORD: 'unused', DB_DATABASE: 'isolated', DB_ENCRYPT: 'true', DB_TRUST_SERVER_CERTIFICATE: 'false' });
  assert.equal(source.isInitialized, false);
  assert.equal(source.options.migrationsRun, false);
  assert.equal(source.options.synchronize, false);
  assert.equal(source.options.dropSchema, false);
  assert.ok(source.options.migrations.includes(UserProfiles1793275200000));
  assert.equal(source.options.migrationsTransactionMode, 'all');
});

test('scoped maintenance prepares/applies/reverts only users v2 with explicit gates and a transactional history', async (t) => {
  const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), vm = require('node:vm');
  const { Migration } = require('typeorm');
  const { InitialSchema1793016000000 } = require('../dist/database/migrations/1793016000000-InitialSchema');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wg-profile-maintenance-'));
  t.after(() => {
    const resolved = path.resolve(directory);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('wg-profile-maintenance-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  const config = path.join(directory, 'isolated.env');
  fs.writeFileSync(config, 'DB_HOST=offline.invalid\nDB_PORT=1433\nDB_USERNAME=fixture\nDB_PASSWORD=unused\nDB_DATABASE=isolated\nDB_ENCRYPT=true\nDB_TRUST_SERVER_CERTIFICATE=false');
  const runner = fixture(), history = [], executed = [], logs = [];
  let commits = 0, rollbacks = 0;
  const query = runner.query;
  const hasTable = runner.hasTable;
  runner.hasTable = async name => name === 'dbo.whatsgestor_migrations' ? history.length > 0 : hasTable(name);
  runner.query = async (sql, params) => {
    if (sql.includes('DB_NAME()')) return [{ name: 'isolated' }];
    if (sql.includes('FROM sys.columns')) return [
      ...[['id','uniqueidentifier',16],['username','nvarchar',200],['passwordHash','nvarchar',510],
        ['isAdmin','bit',1],['canDelete','bit',1],['isActive','bit',1],['createdAt','datetime2',8],['updatedAt','datetime2',8]]
        .map(([name,type,length]) => ({ name,type,length,nullable:false })),
      ...[...runner.columns].map(name => ({ name,type:'nvarchar' })),
    ];
    if (sql.includes('FROM [dbo].[whatsgestor_migrations]')) return history;
    return query(sql, params);
  };
  Object.assign(runner, { connect: async () => {}, release: async () => {},
    startTransaction: async () => { runner.isTransactionActive = true; },
    commitTransaction: async () => { commits++; runner.isTransactionActive = false; },
    rollbackTransaction: async () => { rollbacks++; runner.isTransactionActive = false; },
  });
  const source = { migrations: [new InitialSchema1793016000000(), new UserProfiles1793275200000()],
    initialize: async () => { source.isInitialized = true; }, destroy: async () => { source.isInitialized = false; }, createQueryRunner: () => runner };
  class Executor {
    async executeMigration(migration) {
      executed.push(migration.name); await migration.instance.up(runner);
      history.push({ id: 1, timestamp: migration.timestamp, name: migration.name });
    }
    async deleteMigration() { history.pop(); }
  }
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../scripts/users-profiles.cjs'), 'utf8'), {
    module, exports: module.exports, process: { argv: [] }, console: { log: value => logs.push(value) },
    require: name => name === '../dist/database/data-source' ? { migrationDataSource: () => source }
      : name === 'typeorm' ? { Migration, MigrationExecutor: Executor }
      : name === './database.cjs' ? require('../scripts/database.cjs')
      : name === '../dist/database/migrations/1793275200000-UserProfiles' ? { UserProfiles1793275200000 } : require(name),
  });
  const flags = ['--config',config,'--database','isolated'];
  await module.exports.main(['plan',...flags]);
  assert.equal(commits,0); assert.equal(runner.queries.length,0); assert.equal(executed.length,0);
  assert.equal(JSON.parse(logs.at(-1)).baselineWillNotRun,true);
  for (const extra of [[], ['--apply'], ['--maintenance-approved']]) await assert.rejects(() => module.exports.main(['migrate',...flags,...extra]), /EXPLICIT_MAINTENANCE_APPROVAL_REQUIRED/);
  const approved = [...flags,'--apply','--maintenance-approved'];
  await module.exports.main(['migrate',...approved]);
  assert.deepEqual(executed,['UserProfiles1793275200000']); assert.equal(commits,1);
  await assert.rejects(() => module.exports.main(['migrate',...approved]), /ALREADY_APPLIED/);
  assert.equal(rollbacks,1);
  await module.exports.main(['revert',...approved]);
  assert.equal(commits,2); assert.equal(history.length,0); assert.equal(runner.columns.size,0);
  const invalid = { ...source, migrations: [] };
  history.push({ name: 'UnreviewedMigration' });
  await assert.rejects(() => module.exports.inspect(invalid,runner), /UNKNOWN_MIGRATION_HISTORY/);
});
