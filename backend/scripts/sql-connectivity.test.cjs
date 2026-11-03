const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DataSource } = require('typeorm');
const { createApplication } = require('../dist/application');
const { HealthController } = require('../dist/health/health.controller');
const { User } = require('../dist/users/entities/user.entity');
const { readUsersSchema } = require('./inspect-users-schema.cjs');

test('real Nest initialization, read-only SQL readiness and pool shutdown without HTTP listen', async () => {
  let app;
  let source;
  try {
    app = await createApplication();
    await app.init();
    assert.equal(app.getHttpServer().listening, false);
    source = app.get(DataSource);
    assert.equal(source.isInitialized, true);
    assert.equal(source.options.synchronize, false);
    assert.equal(source.options.migrationsRun, false);
    assert.equal(source.options.dropSchema, false);
    assert.equal(source.entityMetadatas.length, 11);
    const userMetadata = source.getMetadata(User);
    assert.equal(userMetadata.tablePath, 'dbo.users');
    const schema = await readUsersSchema(source);
    assert.equal(schema.columns.length, 8);
    for (const column of userMetadata.columns) {
      const actual = schema.columns.find((item) => item.schema === 'dbo' && item.column === column.databaseName);
      assert.ok(actual, `Missing column: ${column.databaseName}`);
      const expectedType = column.isPrimary ? 'uniqueidentifier' : column.type;
      assert.equal(actual.type, expectedType, `Type mismatch: ${column.databaseName}`);
      assert.equal(actual.nullable, column.isNullable, `Nullability mismatch: ${column.databaseName}`);
      if (column.length) assert.equal(actual.maxLengthBytes, Number(column.length) * 2);
      if (column.type === 'datetime2') assert.equal(actual.scale, column.precision);
    }
    assert.ok(schema.indexes.some((item) => item.schema === 'dbo' && item.column === 'username' && item.isUnique));
    assert.ok(schema.indexes.some((item) => item.schema === 'dbo' && item.column === 'id' && item.isPrimaryKey));
    // Generate and execute an empty repository SELECT: validates mapping without reading user records.
    const query = source.getRepository(User).createQueryBuilder('user').where('1 = 0');
    assert.equal(query.getSql().includes('passwordHash'), false);
    assert.equal((await query.getMany()).length, 0);
    assert.deepEqual(await app.get(HealthController).database(), { status: 'ok', database: 'up' });
  } finally {
    if (app) await app.close();
  }
  assert.equal(source.isInitialized, false);
});
