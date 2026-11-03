require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Global, Module, Controller, Delete, Get, Post, Patch } = require('@nestjs/common');
const { ConfigModule } = require('@nestjs/config');
const { NestFactory } = require('@nestjs/core');
const { JwtService } = require('@nestjs/jwt');
const { DataSource, QueryFailedError } = require('typeorm');
const bcrypt = require('bcryptjs');
const { AuthModule } = require('../dist/auth/auth.module');
const { UsersService } = require('../dist/users/users.service');
const { User } = require('../dist/users/entities/user.entity');
const { AppController } = require('../dist/app.controller');
const { HealthController } = require('../dist/health/health.controller');
const { configureApplication } = require('../dist/application');

const secret = 'fixture-jwt-key-used-only-in-isolated-tests-32';
const password = 'Fixture-password-123';
const publicKeys = ['canDelete', 'createdAt', 'id', 'isActive', 'isAdmin', 'updatedAt', 'username'];

async function fixture(t, v2 = false) {
  const rows = new Map();
  const operations = [];
  let nextError;
  const hash = await bcrypt.hash(password, 4);
  function seed(username, flags = {}) {
    const user = { id: randomUUID(), username, passwordHash: hash, isAdmin: false,
      canDelete: false, isActive: true, createdAt: new Date(), updatedAt: new Date(), ...flags };
    rows.set(user.id, user);
    return user;
  }
  const admin = seed('admin-fixture', { isAdmin: true });
  const regular = seed('regular-fixture');
  const inactive = seed('inactive-fixture', { isActive: false });
  const clone = (user, withHash = false) => {
    if (!user) return null;
    const result = { ...user };
    delete result.fullName; delete result.email; delete result.role; // legacy ORM mapping
    if (!withHash) delete result.passwordHash;
    return result;
  };
  const repository = {
    create: (data) => ({ ...data }),
    find: async () => [...rows.values()].sort((a, b) => a.username.localeCompare(b.username)).map((row) => clone(row)),
    findOneBy: async (where) => clone([...rows.values()].find((row) => Object.entries(where).every(([key, value]) => row[key] === value))),
    countBy: async (where) => [...rows.values()].filter((row) => Object.entries(where).every(([key, value]) => row[key] === value)).length,
    createQueryBuilder: () => {
      let username;
      const query = {
        addSelect: () => query,
        where: (_sql, params) => { username = params.username; return query; },
        getOne: async () => clone([...rows.values()].find((row) => row.username.toLowerCase() === username.toLowerCase()), true),
      };
      return query;
    },
    save: async (data) => {
      operations.push('save');
      if (nextError) { const error = nextError; nextError = undefined; throw error; }
      if ([...rows.values()].some((row) => row.id !== data.id && row.username.toLowerCase() === data.username.toLowerCase())) {
        throw new QueryFailedError('fixture statement', [], Object.assign(new Error('private SQL detail'), { number: 2627 }));
      }
      const id = data.id ?? randomUUID();
      const user = { ...rows.get(id), ...data, id, createdAt: data.createdAt ?? new Date(), updatedAt: new Date() };
      rows.set(id, user);
      return { ...user };
    },
  };
  const source = {
    isInitialized: true, entityMetadatas: [{ target: User }], options: { type: 'mssql' },
    getRepository: () => repository,
    query: async (sql, params) => {
      operations.push(sql);
      if (sql.includes('profileColumnCount')) return [{ profileColumnCount: typeof v2 === 'number' ? v2 : v2 ? 3 : 0 }];
      if (sql.startsWith('SELECT [id], [fullName]')) return params.map((id) => rows.get(id)).map(row => ({...row, fullName: row.fullName ?? null, email: row.email ?? null, role: row.role ?? (row.isAdmin ? 'administrator' : 'attendant')}));
      if (sql.startsWith('UPDATE [dbo].[users] SET [fullName]')) {
        const [fullName,email,role,isAdmin,canDelete,id]=params;
        Object.assign(rows.get(id),{fullName,email,role,isAdmin,canDelete,updatedAt:new Date(Date.now()+1)});
        return [];
      }
      return [{ ok: 1 }];
    },
    transaction: async (callback) => {
      operations.push('transaction');
      const snapshot = structuredClone([...rows]);
      try { return await callback({ getRepository: () => repository, query: source.query }); }
      catch (error) { rows.clear(); for (const [id,row] of snapshot) rows.set(id,row); throw error; }
    },
  };
  class FakeDatabaseModule {}
  Global()(FakeDatabaseModule);
  Module({ providers: [{ provide: DataSource, useValue: source }], exports: [DataSource] })(FakeDatabaseModule);
  class PermissionProbe { remove() { return { ok: true }; } }
  Controller('permission-probe')(PermissionProbe);
  Delete()(PermissionProbe.prototype, 'remove', Object.getOwnPropertyDescriptor(PermissionProbe.prototype, 'remove'));
  const probes = [];
  for (const [prefix, routes] of [
    ['contacts', [['/', Get], ['options', Get], [':id', Get], ['/', Post], [':id', Patch]]],
    ['organizations', [['/', Get]]], ['organization-types', [['/', Get]]], ['contact-types', [['/', Get]]],
    ['contact-display-settings', [['/', Get], [':id', Patch]]],
    ['whatsapp-conversations/:id/messages', [['/', Post], ['attachments', Post], ['audio', Post], ['prepare', Post], ['capabilities', Get]]],
    ['whatsapp-connections', [[':id/disconnect', Post], [':id/connect', Post], [':id/qr', Get], [':id/status', Get]]],
    ['bulk-send/recipient-selections', [['/', Post], ['/', Get]]],
    ['future-unreviewed-route', [['/', Get]]],
  ]) {
    class Probe {}
    Controller(prefix)(Probe);
    routes.forEach(([path, decorator], index) => {
      const name = 'probe' + index;
      Object.defineProperty(Probe.prototype, name, { value() { operations.push('PROBE_EXECUTED:' + prefix); return { ok: true }; } });
      decorator(path)(Probe.prototype, name, Object.getOwnPropertyDescriptor(Probe.prototype, name));
    });
    probes.push(Probe);
  }
  class TestModule {}
  Module({
    imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, ignoreEnvVars: true, skipProcessEnv: true,
      load: [() => ({ JWT_SECRET: secret, JWT_EXPIRES_IN: 3600,
        HOST: '127.0.0.1', PORT: 0, CORS_ORIGINS: ['http://localhost:3000'] })] }), FakeDatabaseModule, AuthModule],
    controllers: [AppController, HealthController, PermissionProbe, ...probes],
  })(TestModule);
  const app = await NestFactory.create(TestModule, { logger: false, forceCloseConnections: true });
  t.after(() => app.close());
  configureApplication(app);
  await app.listen(0, '127.0.0.1');
  const base = await app.getUrl();
  const jwt = app.get(JwtService);
  const token = (user, options = {}) => jwt.signAsync({ sub: user.id, username: user.username, userRevision: user.updatedAt.toISOString() }, options);
  const call = async (path, { bearer, body, method = 'GET', rawBody } = {}) => {
    const headers = {};
    if (bearer) headers.Authorization = `Bearer ${bearer}`;
    if (body !== undefined || rawBody !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetch(base + path, { method, headers,
      body: rawBody ?? (body !== undefined ? JSON.stringify(body) : undefined) });
    return { status: response.status, body: await response.json() };
  };
  return { app, rows, operations, admin, regular, inactive, seed, token, jwt, call,
    failNextSave: (error) => { nextError = error; } };
}

test('login accepts existing bcrypt formats and returns the frontend contract without hashes', async (t) => {
  const f = await fixture(t);
  for (const prefix of ['$2a$', '$2b$']) {
    f.admin.passwordHash = prefix + f.admin.passwordHash.slice(4);
    const response = await f.call('/auth/login', { method: 'POST', body: { username: f.admin.username, password } });
    assert.equal(response.status, 201);
    assert.deepEqual(Object.keys(response.body).sort(), ['accessToken', 'user']);
    assert.deepEqual(Object.keys(response.body.user).sort(), publicKeys);
    const payload = await f.jwt.verifyAsync(response.body.accessToken);
    assert.equal(payload.sub, f.admin.id);
    assert.equal(payload.exp - payload.iat, 3600);
    const me = await f.call('/auth/me', { bearer: response.body.accessToken });
    assert.equal(me.status, 200);
    assert.deepEqual(me.body, response.body.user);
  }
  assert.equal(f.operations.includes('save'), false);
});

test('invalid credentials, inactive users, expiry and forged tokens are rejected', async (t) => {
  const f = await fixture(t);
  for (const credentials of [
    { username: f.admin.username, password: 'incorrect' },
    { username: 'unknown-fixture', password },
    { username: f.inactive.username, password },
    { username: f.admin.username, password: 'é'.repeat(37) },
  ]) {
    const result = await f.call('/auth/login', { method: 'POST', body: credentials });
    assert.equal(result.status, 401);
    assert.equal(result.body.message, 'Usuário ou senha inválidos.');
  }
  for (const bearer of [undefined, 'malformed', await f.token(f.admin, { expiresIn: -1 }),
    await f.token(f.admin, { secret: 'another-fixture-secret' }),
    await f.jwt.signAsync({ sub: 'invalid-uuid' }),
    await f.token(f.admin, { algorithm: 'HS384' }),
    await new JwtService({ secret }).signAsync({ sub: f.admin.id }),
  ]) {
    assert.equal((await f.call('/auth/me', { bearer })).status, 401);
  }
  const bearer = await f.token(f.admin);
  f.admin.isActive = false;
  assert.equal((await f.call('/auth/me', { bearer })).status, 401);
});

test('users endpoints require admin and recheck permissions from the repository', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.call('/users')).status, 401);
  const regularToken = await f.token(f.regular);
  for (const [path, method, body] of [
    ['/users', 'GET'], ['/users/' + f.admin.id, 'GET'], ['/users', 'POST', {}],
    ['/users/' + f.admin.id, 'PATCH', {}], ['/users/' + f.admin.id + '/active', 'PATCH', { isActive: false }],
    ['/users/' + f.admin.id + '/delete-permission', 'PATCH', { canDelete: true }],
  ]) assert.equal((await f.call(path, { bearer: regularToken, method, body })).status, 403);
  assert.equal((await f.call('/auth/me', { bearer: regularToken })).status, 200);
  const adminToken = await f.token(f.admin);
  assert.equal((await f.call('/users', { bearer: adminToken })).status, 200);
  f.admin.isAdmin = false;
  assert.equal((await f.call('/users', { bearer: adminToken })).status, 403);
  assert.equal(f.operations.includes('save'), false);
});

test('create, update and permission routes operate only on isolated users', async (t) => {
  const f = await fixture(t);
  const bearer = await f.token(f.admin);
  const created = await f.call('/users', { bearer, method: 'POST', body: {
    username: ' new-fixture ', password, isAdmin: false, canDelete: false, isActive: true,
  } });
  assert.equal(created.status, 201);
  assert.equal(created.body.username, 'new-fixture');
  assert.deepEqual(Object.keys(created.body).sort(), publicKeys);
  assert.equal(await bcrypt.compare(password, f.rows.get(created.body.id).passwordHash), true);
  const id = created.body.id;
  assert.equal((await f.call('/users/' + id, { bearer })).status, 200);
  let response = await f.call('/users/' + id, { bearer, method: 'PATCH', body: {
    username: 'renamed-fixture', password: 'Updated-fixture-123', isAdmin: true,
  } });
  assert.equal(response.status, 200);
  assert.equal(response.body.isAdmin, true);
  assert.equal(await bcrypt.compare('Updated-fixture-123', f.rows.get(id).passwordHash), true);
  response = await f.call('/users/' + id + '/delete-permission', { bearer, method: 'PATCH', body: { canDelete: true } });
  assert.equal(response.body.canDelete, true);
  response = await f.call('/users/' + id + '/active', { bearer, method: 'PATCH', body: { isActive: false } });
  assert.equal(response.body.isActive, false);
  assert.equal((await f.call('/users', { bearer })).body.length, 4);
  assert.ok(f.operations.includes('SELECT TOP (1) [id] FROM [dbo].[users] WITH (TABLOCKX, HOLDLOCK)'));
});

test('validation rejects invalid fields, UUIDs, nulls and oversized bcrypt input', async (t) => {
  const f = await fixture(t);
  const bearer = await f.token(f.admin);
  for (const body of [{}, { username: 'x', password: 'x', extra: true }, { username: 123, password }, { username: 'x', password: null }]) {
    assert.equal((await f.call('/auth/login', { method: 'POST', body })).status, 400);
  }
  for (const body of [{ isActive: 'false' }, { isAdmin: null }, { password: null }, { username: '   ' }, { password: 'short' }, { extra: true }]) {
    assert.equal((await f.call('/users/' + f.regular.id, { bearer, method: 'PATCH', body })).status, 400);
  }
  assert.equal((await f.call('/users/not-a-uuid', { bearer })).status, 400);
  assert.equal((await f.call('/users/' + randomUUID(), { bearer })).status, 404);
  assert.equal((await f.call('/users/' + f.regular.id, { bearer, method: 'PATCH', body: { password: 'é'.repeat(37) } })).status, 400);
  assert.equal((await f.call('/auth/login', { method: 'POST', rawBody: '{bad-json' })).status, 400);
  assert.equal(f.operations.includes('save'), false);
});

test('duplicate usernames conflict and the last active admin cannot be demoted or disabled', async (t) => {
  const f = await fixture(t);
  const bearer = await f.token(f.admin);
  for (const body of [{ isAdmin: false }, { isActive: false }]) {
    assert.equal((await f.call('/users/' + f.admin.id, { bearer, method: 'PATCH', body })).status, 409);
    assert.equal(f.admin.isAdmin && f.admin.isActive, true);
  }
  assert.equal((await f.call('/users/' + f.admin.id + '/active', { bearer, method: 'PATCH', body: { isActive: false } })).status, 409);
  assert.equal((await f.call('/users/' + f.regular.id, { bearer, method: 'PATCH', body: { username: f.admin.username } })).status, 409);
  assert.equal((await f.call('/users', { bearer, method: 'POST', body: {
    username: f.admin.username, password, isAdmin: false, canDelete: false, isActive: true,
  } })).status, 409);
  f.seed('second-admin-fixture', { isAdmin: true });
  assert.equal((await f.call('/users/' + f.admin.id, { bearer, method: 'PATCH', body: { isAdmin: false } })).status, 200);
});

test('DELETE permission is enforced and health routes remain public under global guards', async (t) => {
  const f = await fixture(t);
  const bearer = await f.token(f.regular);
  assert.equal((await f.call('/permission-probe', { bearer, method: 'DELETE' })).status, 403);
  f.regular.canDelete = true;
  assert.equal((await f.call('/permission-probe', { bearer, method: 'DELETE' })).status, 200);
  assert.equal((await f.call('/permission-probe', { bearer: await f.token(f.admin), method: 'DELETE' })).status, 200);
  for (const path of ['/', '/health', '/health/ready', '/health/database']) {
    assert.equal((await f.call(path)).status, 200);
  }
});

test('SQL errors never disclose parameters or hashes through HTTP', async (t) => {
  const f = await fixture(t);
  const bearer = await f.token(f.admin);
  f.failNextSave(new QueryFailedError('private query', ['private-parameter-marker'], new Error('private-driver-marker')));
  const response = await f.call('/users/' + f.regular.id, { bearer, method: 'PATCH', body: { canDelete: true } });
  assert.equal(response.status, 503);
  assert.equal(JSON.stringify(response.body).includes('private-'), false);
});

test('password reset revokes previous tokens and only the new password logs in', async (t) => {
  const f = await fixture(t);
  const bearer = await f.token(f.admin);
  const oldToken = await f.token(f.regular);
  const reset = await f.call('/users/' + f.regular.id, { bearer, method: 'PATCH', body: { password: 'Reset-fixture-456' } });
  assert.equal(reset.status, 200);
  assert.equal((await f.call('/auth/me', { bearer: oldToken })).status, 401);
  assert.equal((await f.call('/auth/login', { method: 'POST', body: { username: f.regular.username, password } })).status, 401);
  const login = await f.call('/auth/login', { method: 'POST', body: { username: f.regular.username, password: 'Reset-fixture-456' } });
  assert.equal(login.status, 201);
  assert.equal((await f.call('/auth/me', { bearer: login.body.accessToken })).status, 200);
  assert.equal((await f.call('/auth/me', { bearer })).status, 200);
});

test('deactivation, reactivation and role changes revoke earlier tokens', async (t) => {
  const f = await fixture(t);
  const bearer = await f.token(f.admin);
  let oldToken = await f.token(f.regular);
  for (const isActive of [false, true]) {
    assert.equal((await f.call('/users/' + f.regular.id + '/active', { bearer, method: 'PATCH', body: { isActive } })).status, 200);
    assert.equal((await f.call('/auth/me', { bearer: oldToken })).status, 401);
  }
  oldToken = await f.token(f.rows.get(f.regular.id));
  assert.equal((await f.call('/users/' + f.regular.id, { bearer, method: 'PATCH', body: { isAdmin: true } })).status, 200);
  assert.equal((await f.call('/auth/me', { bearer: oldToken })).status, 401);
});

test('legacy sessions remain valid for unchanged users and expire after an edit', async (t) => {
  const f = await fixture(t);
  const issuedAt = Math.floor(Date.now() / 1000);
  f.regular.updatedAt = new Date((issuedAt - 60) * 1000);
  const legacy = await f.jwt.signAsync({ sub: f.regular.id, iat: issuedAt });
  assert.equal((await f.call('/auth/me', { bearer: legacy })).status, 200);
  f.regular.updatedAt = new Date(issuedAt * 1000 + 1);
  assert.equal((await f.call('/auth/me', { bearer: legacy })).status, 401);
});

test('expanded profiles remain disabled on the old SQL schema and partial upgrades fail closed', async (t) => {
  const legacy = await fixture(t);
  const bearer = await legacy.token(legacy.admin);
  assert.deepEqual((await legacy.call('/users/schema', { bearer })).body, { profileFieldsAvailable: false });
  const response = await legacy.call('/users', { bearer, method: 'POST', body: {
    username: 'blocked-before-migration', fullName: 'Pessoa Teste', role: 'tester', password,
    isAdmin: false, canDelete: false, isActive: true,
  } });
  assert.equal(response.status, 409);
  assert.equal(legacy.operations.includes('save'), false);
  const partial = await fixture(t, 2);
  assert.equal((await partial.call('/auth/me', { bearer: await partial.token(partial.admin) })).status, 503);
});

test('new schema adds names, optional email and tester without changing old usernames or hashes', async (t) => {
  const f = await fixture(t, true);
  const bearer = await f.token(f.admin);
  const originalHash = f.admin.passwordHash;
  const me = await f.call('/auth/me', { bearer });
  assert.equal(me.status, 200);
  assert.equal(me.body.username, f.admin.username);
  assert.equal(me.body.role, 'administrator');
  assert.equal(me.body.fullName, null);
  assert.equal(me.body.email, null);
  assert.equal(f.admin.passwordHash, originalHash);
  const created = await f.call('/users', { bearer, method: 'POST', body: {
    username: 'tester-fixture', fullName: '  Pessoa Testadora  ', email: null, role: 'tester', password,
    isAdmin: false, canDelete: false, isActive: true,
  } });
  assert.equal(created.status, 201);
  assert.equal(created.body.fullName, 'Pessoa Testadora');
  assert.equal(created.body.role, 'tester');
  assert.equal(created.body.email, null);
  assert.equal(Object.hasOwn(created.body, 'passwordHash'), false);
  const hash = f.rows.get(created.body.id).passwordHash;
  assert.equal(await bcrypt.compare(password, hash), true);
  const changed = await f.call('/users/' + created.body.id, { bearer, method: 'PATCH', body: { email: 'teste@example.invalid', fullName: 'Nome Atualizado' } });
  assert.equal(changed.status, 200);
  assert.equal(changed.body.email, 'teste@example.invalid');
  assert.equal(f.rows.get(created.body.id).passwordHash, hash);
  const login = await f.call('/auth/login', { method: 'POST', body: { username: 'tester-fixture', password } });
  assert.equal(login.status, 201);
  assert.equal(login.body.user.role, 'tester');
  const token = login.body.accessToken;
  assert.equal((await f.call('/auth/me', { bearer: token })).status, 200);
  assert.equal((await f.call('/users/' + created.body.id, { bearer, method: 'PATCH', body: { role: 'attendant' } })).status, 200);
  assert.equal((await f.call('/auth/me', { bearer: token })).status, 401);
});

test('tester global guard blocks critical HTTP operations before any controller is executed', async (t) => {
  const f = await fixture(t, true);
  const tester = f.seed('tester-fixture', { role: 'tester', canDelete: false });
  const bearer = await f.token(tester);
  for (const path of ['/auth/me', '/contacts', '/contacts/options', '/contacts/' + f.regular.id,
    '/organizations', '/organization-types', '/contact-types', '/contact-display-settings']) {
    assert.equal((await f.call(path, { bearer })).status, 200, path);
  }
  const before = f.operations.filter(x => x.startsWith('PROBE_EXECUTED')).length;
  for (const [path, method, body] of [
    ['/users', 'GET'], ['/users/schema', 'GET'], ['/users', 'POST', {}], ['/users/' + f.admin.id, 'PATCH', { password }],
    ['/contacts', 'POST', {}], ['/contacts/' + f.regular.id, 'PATCH', {}], ['/permission-probe', 'DELETE'],
    ['/contact-display-settings/' + f.regular.id, 'PATCH', {}],
    ['/whatsapp-conversations/' + f.regular.id + '/messages', 'POST', {}],
    ['/whatsapp-conversations/' + f.regular.id + '/messages/attachments', 'POST', {}],
    ['/whatsapp-conversations/' + f.regular.id + '/messages/audio', 'POST', {}],
    ['/whatsapp-conversations/' + f.regular.id + '/messages/prepare', 'POST', {}],
    ['/whatsapp-conversations/' + f.regular.id + '/messages/capabilities', 'GET'],
    ['/whatsapp-connections/' + f.regular.id + '/disconnect', 'POST', {}],
    ['/whatsapp-connections/' + f.regular.id + '/connect', 'POST', {}],
    ['/whatsapp-connections/' + f.regular.id + '/qr', 'GET'],
    ['/whatsapp-connections/' + f.regular.id + '/status', 'GET'],
    ['/bulk-send/recipient-selections', 'POST', {}], ['/bulk-send/recipient-selections', 'GET'],
    ['/future-unreviewed-route?allowWrite=true', 'GET'],
  ]) assert.equal((await f.call(path, { bearer, method, body })).status, 403, method + ' ' + path);
  assert.equal(f.operations.filter(x => x.startsWith('PROBE_EXECUTED')).length, before);
  tester.isAdmin = true; tester.canDelete = true; // guard still fails closed on inconsistent flags
  assert.equal((await f.call('/users', { bearer })).status, 403);
});

test('profile validation, rollback, role transitions and last administrator remain safe', async (t) => {
  const f = await fixture(t, true);
  const bearer = await f.token(f.admin);
  for (const body of [{ fullName: '' }, { fullName: null }, { fullName: 'x'.repeat(201) }, { email: 'invalid' },
    { role: 'unknown' }, { role: 'tester', isAdmin: true }, { role: 'tester', canDelete: true }]) {
    assert.equal((await f.call('/users/' + f.regular.id, { bearer, method: 'PATCH', body })).status, 400);
  }
  assert.equal((await f.call('/users/' + f.admin.id, { bearer, method: 'PATCH', body: { role: 'tester' } })).status, 409);
  f.failNextSave(new QueryFailedError('fixture', [], new Error('fixture')));
  const original = structuredClone(f.rows.get(f.regular.id));
  assert.equal((await f.call('/users/' + f.regular.id, { bearer, method: 'PATCH', body: { role: 'tester', fullName: 'Rollback' } })).status, 503);
  assert.deepEqual(f.rows.get(f.regular.id), original);
  for (const role of ['tester', 'administrator', 'attendant']) {
    const response = await f.call('/users/' + f.regular.id, { bearer, method: 'PATCH', body: { role } });
    assert.equal(response.status, 200);
    assert.equal(response.body.role, role);
    assert.equal(response.body.isAdmin, role === 'administrator');
  }
});
