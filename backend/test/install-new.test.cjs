const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parse } = require('dotenv');
const { envLine, resolveInstance, provision, main } = require('../scripts/install-new.cjs');

test('instance resolver refuses live env paths, including Windows case variants, before any access', async () => {
  for (const file of ['.env', '.ENV']) await assert.rejects(() => main(['resolve-instance', path.resolve(__dirname, '..', file)]), /LIVE_ENV_CANNOT_BE_TARGET_FILE/);
});

test('installer env values preserve passwords and Windows paths exactly', () => {
  for (const value of ['C:\\ProgramData\\WhatsGestor', ' # password = value ', 'quote\'and#hash', 'double"quote', 'back`tick']) {
    assert.equal(parse(envLine('VALUE', value)).VALUE, value);
  }
  assert.throws(() => envLine('VALUE', 'line\ninjection'), /ENV_VALUE_INVALID/);
  assert.throws(() => envLine('VALUE', '\'"`'), /QUOTES_UNSUPPORTED/);
});

test('named instance resolution produces fixed TCP port without starting the application', async () => {
  let closed = false;
  const values = { DB_HOST: 'isolated.invalid', DB_PORT: '1433', WG_SQL_INSTANCE: 'TEST', DB_ENCRYPT: 'true' };
  const result = await resolveInstance(values, async options => {
    assert.equal(options.options.instanceName, 'TEST');
    assert.equal(options.port, undefined);
    assert.equal(options.database, 'master');
    return { request: () => ({ query: async () => ({ recordset: [{ port: 51433 }] }) }), close: async () => { closed = true; } };
  });
  assert.equal(result.DB_PORT, '51433');
  assert.equal(values.DB_PORT, '1433');
  assert.equal(closed, true);
  assert.equal(await resolveInstance({ DB_HOST: 'offline.invalid' }, () => assert.fail('no connection expected')).then(v => v.DB_HOST), 'offline.invalid');
});

function fixture(t, { exists = false, total = 0, admins = 0, planFails = false } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wg-installer-offline-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const config = path.join(directory, 'target.env');
  const values = { DB_HOST: 'offline.invalid', DB_PORT: '1433', DB_DATABASE: 'wg_test]quoted', DB_USERNAME: 'offline',
    DB_PASSWORD: 'fixture-not-a-secret', DB_ENCRYPT: 'true', DB_TRUST_SERVER_CERTIFICATE: 'false' };
  fs.writeFileSync(config, Object.entries(values).map(([key, value]) => envLine(key, value)).join(''));
  const previous = process.env.WG_INITIAL_ADMIN_PASSWORD;
  process.env.WG_INITIAL_ADMIN_PASSWORD = 'offline-initial-admin-password';
  t.after(() => { if (previous === undefined) delete process.env.WG_INITIAL_ADMIN_PASSWORD; else process.env.WG_INITIAL_ADMIN_PASSWORD = previous; });
  const statements = [], actions = [], targets = [];
  const dependencies = {
    connect: async options => {
      targets.push(options.database);
      return { request: () => ({ input() { return this; }, query: async text => {
        statements.push(text);
        if (text.startsWith('CREATE DATABASE')) exists = true;
        return { recordset: text.includes('DB_ID') ? [{ id: exists ? 5 : null }] : [{ total, admins }] };
      } }), close: async () => {} };
    },
    main: async argv => {
      actions.push(argv[0]);
      if (argv[0] === 'plan' && planFails) throw Error('UNVERSIONED_EXISTING_SCHEMA_REQUIRES_REVIEW');
      if (argv[0] === 'bootstrap') { total++; admins++; }
    },
  };
  return { options: { config, database: values.DB_DATABASE, username: 'offline-admin', apply: true }, dependencies, statements, actions, targets };
}

test('new database is escaped, migrations precede bootstrap, repeat preserves users', async t => {
  const f = fixture(t);
  assert.equal((await provision(f.options, f.dependencies)).initialAdminCreated, true);
  assert.ok(f.statements.includes('CREATE DATABASE [wg_test]]quoted]'));
  assert.deepEqual(f.actions, ['plan', 'migrate', 'bootstrap']);
  f.actions.length = 0;
  const result = await provision(f.options, f.dependencies);
  assert.equal(result.initialAdminCreated, false);
  assert.equal(result.existingUsersPreserved, true);
  assert.deepEqual(f.actions, ['plan', 'migrate']);
});

test('existing unknown schema refuses migrations and bootstrap', async t => {
  const f = fixture(t, { exists: true, planFails: true });
  await assert.rejects(() => provision(f.options, f.dependencies), /UNVERSIONED_EXISTING_SCHEMA/);
  assert.deepEqual(f.actions, ['plan']);
  assert.ok(!f.statements.some(text => text.startsWith('CREATE')));
});

test('existing active administrator is preserved; missing administrator requires review', async t => {
  const f = fixture(t, { exists: true, total: 3, admins: 1 });
  assert.equal((await provision(f.options, f.dependencies)).initialAdminCreated, false);
  assert.ok(!f.actions.includes('bootstrap'));
  const invalid = fixture(t, { exists: true, total: 3, admins: 0 });
  await assert.rejects(() => provision(invalid.options, invalid.dependencies), /WITHOUT_ACTIVE_ADMIN/);
  assert.ok(!invalid.actions.includes('bootstrap'));
});

test('missing apply or invalid password cannot connect to SQL', async t => {
  const f = fixture(t);
  await assert.rejects(() => provision({ ...f.options, apply: false }, f.dependencies), /APPLY_REQUIRED/);
  process.env.WG_INITIAL_ADMIN_PASSWORD = 'short';
  await assert.rejects(() => provision(f.options, f.dependencies), /STRONG_PASSWORD/);
  assert.equal(f.targets.length, 0);
});
