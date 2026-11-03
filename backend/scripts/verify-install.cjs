// SELECT-only SQL + real AuthService verification. Does not bootstrap Nest/WhatsApp.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { args, target, plan } = require('./database.cjs');
const { migrationDataSource } = require('../dist/database/data-source');
const { TABLES_V1, COLUMNS_V1, SQL_V1 } = require('../dist/database/migrations/schema-v1');
const { RECIPIENT_TABLES, RECIPIENT_COLUMNS, RECIPIENT_SQL } = require('../dist/database/migrations/schema-recipient-selections');
const { User } = require('../dist/users/entities/user.entity');
const { UsersService } = require('../dist/users/users.service');
const { UsersProfileStore } = require('../dist/users/users-profile.store');
const { AuthService } = require('../dist/auth/auth.service');
const { JwtService } = require('@nestjs/jwt');

async function main() {
  const options = args(['plan', ...process.argv.slice(2)]);
  if (options['maintenance-approved'] || options.apply) throw Error('VERIFY_CANNOT_OVERRIDE_LIVE_DATABASE_PROTECTION');
  const values = target(options);
  const password = process.env.WG_INITIAL_ADMIN_PASSWORD;
  if (!options.username || !password) throw Error('VERIFY_REQUIRES_USERNAME_AND_PASSWORD');
  const source = migrationDataSource(values);
  let runner;
  try {
    await source.initialize();
    runner = source.createQueryRunner();
    await runner.connect();
    const status = await plan(source, runner);
    assert.equal(status.pending.length, 0, 'VERIFY_MIGRATIONS_PENDING');
    const names = [...TABLES_V1, ...RECIPIENT_TABLES];
    const tables = await runner.getTables(names.map(name => 'dbo.' + name));
    assert.equal(tables.length, 17, 'VERIFY_MISSING_TABLES');
    for (const [name, columns] of Object.entries({ ...COLUMNS_V1, ...RECIPIENT_COLUMNS })) {
      const table = tables.find(table => table.name === name || table.name === 'dbo.' + name);
      assert.ok(table, 'VERIFY_MISSING_TABLE');
      for (const column of columns) assert.ok(table.columns.some(item => item.name === column), 'VERIFY_MISSING_COLUMN');
    }
    const usersTable = tables.find(table => /(^|\.)users$/.test(table.name));
    for (const column of ['fullName', 'email', 'role']) assert.ok(usersTable.columns.some(item => item.name === column), 'VERIFY_MISSING_PROFILE_COLUMN');
    const ddl = [...SQL_V1, ...RECIPIENT_SQL].join('\n');
    const expectedConstraints = [...ddl.matchAll(/\bCONSTRAINT\s+["\[]([^"\]]+)["\]]/gi)].map(match => match[1]);
    expectedConstraints.push('DF_users_role_v2', 'CK_users_role_v2');
    const constraints = await runner.query("SELECT [name] FROM sys.objects WHERE schema_id=SCHEMA_ID(N'dbo') AND [type] IN ('F','C','UQ','PK','D')");
    for (const name of expectedConstraints) assert.ok(constraints.some(item => item.name === name), 'VERIFY_MISSING_CONSTRAINT');
    const expectedIndexes = [...ddl.matchAll(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+["\[]([^"\]]+)["\]]/gi)].map(match => match[1]);
    const indexes = await runner.query("SELECT i.[name] FROM sys.indexes i JOIN sys.tables t ON t.object_id=i.object_id WHERE t.schema_id=SCHEMA_ID(N'dbo')");
    for (const name of expectedIndexes) assert.ok(indexes.some(item => item.name === name), 'VERIFY_MISSING_INDEX');
    const users = new UsersService(source.getRepository(User), source, new UsersProfileStore(source));
    const jwt = new JwtService({ secret: crypto.randomBytes(48).toString('hex'), signOptions: { expiresIn: 60 } });
    const auth = new AuthService(users, jwt);
    const login = await auth.login({ username: options.username, password });
    assert.equal(login.user.isAdmin, true, 'VERIFY_ADMIN_PERMISSION_MISSING');
    assert.equal(login.user.canDelete, true, 'VERIFY_DELETE_PERMISSION_MISSING');
    assert.equal(login.user.isActive, true, 'VERIFY_ADMIN_INACTIVE');
    assert.equal(login.user.role, 'administrator', 'VERIFY_ADMIN_ROLE_MISSING');
    assert.equal(jwt.verify(login.accessToken).sub.toLowerCase(), login.user.id.toLowerCase());
    await assert.rejects(() => auth.login({ username: options.username, password: crypto.randomBytes(48).toString('hex') }),
      error => error.getStatus?.() === 401);
    console.log(JSON.stringify({ tables: tables.length, pendingMigrations: 0,
      foreignKeys: tables.reduce((count, table) => count + table.foreignKeys.length, 0),
      indexes: tables.reduce((count, table) => count + table.indices.length, 0),
      administratorAuthenticated: true, administratorPermissions: true, wrongPasswordRejected: true,
      expectedConstraintsChecked: expectedConstraints.length, expectedIndexesChecked: expectedIndexes.length,
      whatsappStarted: false }));
  } finally {
    if (runner) await runner.release();
    if (source.isInitialized) await source.destroy();
  }
}
if (require.main === module) main().catch(error => {
  const safe = /^[A-Z][A-Z0-9_]+$/.test(error.message ?? '') ? error.message : 'VERIFY_INSTALL_FAILED';
  console.error(safe); process.exitCode = 1;
});
