const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ConfigService } = require('@nestjs/config');
const { validateEnvironment } = require('../dist/config/environment');
const { createDatabaseOptions, initializeDataSource } = require('../dist/config/database');
const { DataSource } = require('typeorm');

const fixture = {
  DB_HOST: 'localhost', DB_PORT: '1433', DB_USERNAME: 'fixture-user',
  DB_PASSWORD: 'fixture-secret', DB_DATABASE: 'fixture-database',
  JWT_SECRET: 'fixture-jwt-key-for-tests-only-32-characters',
};

test('defaults preserve local HTTP and SQL behavior without changing credentials', () => {
  const input = { ...fixture };
  const config = validateEnvironment(input);
  assert.equal(config.HOST, '127.0.0.1');
  assert.equal(config.PORT, 3001);
  assert.equal(config.DB_PORT, 1433);
  assert.equal(config.DB_PASSWORD, fixture.DB_PASSWORD);
  assert.deepEqual(input, fixture);
  assert.deepEqual(config.CORS_ORIGINS, ['http://localhost:3000', 'http://127.0.0.1:3000']);
  assert.equal(config.DB_ENCRYPT, false);
  assert.equal(config.DB_TRUST_SERVER_CERTIFICATE, true);
});

test('explicit port, TLS and CORS settings are normalized', () => {
  const config = validateEnvironment({ ...fixture, PORT: '3010', HOST: '::1',
    DB_ENCRYPT: 'true', DB_TRUST_SERVER_CERTIFICATE: 'false',
    CORS_ORIGINS: 'https://example.test, https://example.test' });
  assert.equal(config.PORT, 3010);
  assert.equal(config.DB_ENCRYPT, true);
  assert.equal(config.DB_TRUST_SERVER_CERTIFICATE, false);
  assert.deepEqual(config.CORS_ORIGINS, ['https://example.test']);
});

test('invalid or absent configuration is rejected without echoing values', () => {
  for (const key of ['DB_HOST', 'DB_PORT', 'DB_USERNAME', 'DB_PASSWORD', 'DB_DATABASE']) {
    const config = { ...fixture };
    delete config[key];
    assert.throws(() => validateEnvironment(config), new RegExp(key));
  }
  for (const value of ['', '0', '65536', '-1', 'abc', '1.5', '1e3']) {
    assert.throws(() => validateEnvironment({ ...fixture, PORT: value }), /PORT/);
    assert.throws(() => validateEnvironment({ ...fixture, DB_PORT: value }), /DB_PORT/);
  }
  for (const value of ['*', '', 'https://example.test/path', 'http://user:secret@example.test', 'file:///tmp']) {
    assert.throws(() => validateEnvironment({ ...fixture, CORS_ORIGINS: value }), (error) => {
      assert.match(error.message, /CORS_ORIGINS/);
      assert.equal(error.message.includes('secret'), false);
      return true;
    });
  }
  assert.throws(() => validateEnvironment({ ...fixture, DB_ENCRYPT: 'yes' }), /DB_ENCRYPT/);
  assert.throws(() => validateEnvironment({ ...fixture, HOST: 'http://localhost' }), /HOST/);
});

test('SQL options cannot enable schema synchronization or migrations through environment', () => {
  const config = validateEnvironment({ ...fixture, synchronize: true, migrationsRun: true });
  const options = createDatabaseOptions(new ConfigService(config));
  assert.equal(options.synchronize, false);
  assert.equal(options.migrationsRun, false);
  assert.equal(options.dropSchema, false);
  assert.equal(options.autoLoadEntities, false);
  assert.deepEqual(options.entities.map((entity) => entity.name), ['User',
    'OrganizationType', 'Organization', 'ContactType', 'Contact',
    'ContactDisplaySetting', 'ContactCampaignPreference', 'ContactCampaignPreferenceEvent',
    'WhatsappConversation', 'WhatsappMessage', 'WhatsappMessageMedia',
    'RecipientSelection', 'RecipientSelectionRevision', 'RecipientSelectionItem',
    'RecipientSelectionSource', 'RecipientSelectionOperation']);
  assert.equal(options.requestTimeout, 5000);
});

test('JWT settings are mandatory and never included in validation errors', () => {
  for (const JWT_SECRET of [undefined, '', 'short-private-marker']) {
    assert.throws(() => validateEnvironment({ ...fixture, JWT_SECRET }), (error) => {
      assert.match(error.message, /JWT_SECRET/);
      assert.equal(error.message.includes('short-private-marker'), false);
      return true;
    });
  }
  for (const JWT_EXPIRES_IN of ['', '0', '-1', '1h', '1.5', '9007199254740992']) {
    assert.throws(() => validateEnvironment({ ...fixture, JWT_EXPIRES_IN }), /JWT_EXPIRES_IN/);
  }
  assert.equal(validateEnvironment(fixture).JWT_EXPIRES_IN, 3600);
  assert.equal(validateEnvironment({ ...fixture, JWT_EXPIRES_IN: '7200' }).JWT_EXPIRES_IN, 7200);
});

test('driver initialization failure is sanitized before Nest can log it', async (t) => {
  t.mock.method(DataSource.prototype, 'initialize', async () => {
    throw new Error('Login failed fixture-user fixture-secret');
  });
  const options = createDatabaseOptions(new ConfigService(validateEnvironment(fixture)));
  await assert.rejects(initializeDataSource(options), (error) => {
    assert.match(error.message, /SQL_INIT_FAILED/);
    assert.equal(error.message.includes('fixture-secret'), false);
    assert.equal(error.message.includes('fixture-user'), false);
    return true;
  });
});
