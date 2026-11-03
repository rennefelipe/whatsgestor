require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { resolve } = require('node:path');
const { Module } = require('@nestjs/common');
const { NestFactory } = require('@nestjs/core');
const { ConfigService } = require('@nestjs/config');
const { DataSource } = require('typeorm');
const { AppController } = require('../dist/app.controller');
const { HealthController } = require('../dist/health/health.controller');
const { configureApplication, startApplication } = require('../dist/application');

test('HTTP contracts, CORS, database failure and shutdown on an ephemeral port', async (t) => {
  const queries = [];
  let unavailable = false;
  let closed = false;
  const database = {
    isInitialized: true,
    async query(sql) {
      queries.push(sql);
      if (unavailable) throw new Error('private-driver-detail');
      return [{ ok: 1 }];
    },
  };
  class TestModule { onApplicationShutdown() { closed = true; } }
  Module({
    controllers: [AppController, HealthController],
    providers: [
      { provide: DataSource, useValue: database },
      { provide: ConfigService, useValue: new ConfigService({
        HOST: '127.0.0.1', PORT: 0,
        CORS_ORIGINS: ['http://localhost:3000', 'http://127.0.0.1:3000'],
      }) },
    ],
  })(TestModule);
  const before = process.listenerCount('SIGTERM');
  const app = await NestFactory.create(TestModule, { logger: false, forceCloseConnections: true });
  t.after(async () => { if (!closed) await app.close(); });
  configureApplication(app);
  assert.equal(process.listenerCount('SIGTERM'), before + 1);
  await startApplication(async () => app);
  const address = app.getHttpServer().address();
  assert.notEqual(address.port, 3001);
  const base = `http://127.0.0.1:${address.port}`;
  const get = (path, options) => fetch(`${base}${path}`, options);

  let response = await get('/');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    sistema: 'WhatsGestor', componente: 'Backend', status: 'online', versao: '1.0.0',
  });
  response = await get('/health');
  assert.deepEqual(await response.json(), { status: 'ok' });
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(queries.length, 0);

  for (const path of ['/health/database', '/health/ready']) {
    response = await get(path);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'ok', database: 'up' });
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  assert.deepEqual(queries, ['SELECT 1 AS ok', 'SELECT 1 AS ok']);
  unavailable = true;
  response = await get('/health/ready');
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { status: 'error', database: 'down' });
  assert.equal((await get('/health')).status, 200);
  database.isInitialized = false;
  const count = queries.length;
  assert.equal((await get('/health/database')).status, 503);
  assert.equal(queries.length, count);

  for (const origin of ['http://localhost:3000', 'http://127.0.0.1:3000']) {
    response = await get('/health', { method: 'OPTIONS', headers: {
      Origin: origin, 'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': 'authorization,content-type',
    } });
    assert.equal(response.status, 204);
    assert.equal(response.headers.get('access-control-allow-origin'), origin);
  }
  response = await get('/health', { headers: { Origin: 'http://untrusted.test' } });
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  await app.close();
  assert.equal(closed, true);
  assert.equal(process.listenerCount('SIGTERM'), before);
  assert.equal(app.getHttpServer().listening, false);
});

test('failed listen closes the application and preserves the original failure', async () => {
  const failure = Object.assign(new Error('test port conflict'), { code: 'EADDRINUSE' });
  let closed = false;
  const app = {
    get: () => new ConfigService({ PORT: 0, HOST: '127.0.0.1' }),
    listen: async () => { throw failure; },
    close: async () => { closed = true; },
  };
  await assert.rejects(startApplication(async () => app), (error) => error === failure);
  assert.equal(closed, true);
});

test('invalid environment exits startup before connecting or binding a port', () => {
  const result = spawnSync(process.execPath, [resolve(__dirname, '../dist/main.js')], {
    cwd: resolve(__dirname, '../..'),
    env: { ...process.env, DB_PORT: '0', DB_PASSWORD: 'startup-private-marker', NO_COLOR: '1' },
    encoding: 'utf8', timeout: 30000,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  const output = result.stdout + result.stderr;
  assert.match(output, /Falha ao iniciar o backend/);
  assert.equal(output.includes('startup-private-marker'), false);
  assert.equal(output.includes('Retrying'), false);
});
