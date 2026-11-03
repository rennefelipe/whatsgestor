const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolve } = require('node:path');
const { readFileSync } = require('node:fs');
const { parse } = require('dotenv');
const { ConfigService } = require('@nestjs/config');
const { validateEnvironment } = require('../dist/config/environment');
const { createDatabaseOptions, initializeDataSource } = require('../dist/config/database');
const { readRegistrationSchema, tables } = require('./inspect-registration-schema.cjs');
const { Contact } = require('../dist/contacts/entities/contact.entity');
const normalize = (value) => value.replace(/[\s()[\]]/g, '').toLowerCase();

test('registration metadata, relationships, filtered indexes and empty SELECTs match existing SQL without writes', async () => {
  let source;
  try {
    const values = { ...parse(readFileSync(resolve(__dirname, '../.env'))), ...process.env };
    // Catalog inspection can exceed the normal query timeout. Only this diagnostic pool uses 30s.
    source = await initializeDataSource({ ...createDatabaseOptions(new ConfigService(validateEnvironment(values))), requestTimeout: 30000 });
    assert.equal(source.options.synchronize, false);
    assert.equal(source.options.migrationsRun, false);
    assert.equal(source.options.dropSchema, false);
    assert.equal(source.entityMetadatas.length, 11);
    const createRunner = source.createQueryRunner.bind(source);
    source.createQueryRunner = (...args) => {
      const runner = createRunner(...args);
      const query = runner.query.bind(runner);
      runner.query = (sql, ...parameters) => {
        assert.match(sql.trim(), /^SELECT\b/i, 'Live diagnostic permits SELECT only');
        return query(sql, ...parameters);
      };
      return runner;
    };
    const schema = await readRegistrationSchema(source);
    assert.deepEqual([...new Set(schema.columns.map((column) => column.table))].sort(), [...tables].sort());
    for (const metadata of source.entityMetadatas.filter((entity) => tables.includes(entity.tableName))) {
      assert.equal(metadata.schema, 'dbo');
      const actualColumns = schema.columns.filter((column) => column.table === metadata.tableName);
      assert.equal(actualColumns.length, metadata.columns.length, `Column count: ${metadata.tableName}`);
      for (const column of metadata.columns) {
        const actual = actualColumns.find((item) => item.column === column.databaseName);
        assert.ok(actual, `Missing column: ${metadata.tableName}.${column.databaseName}`);
        assert.equal(actual.type, source.driver.normalizeType(column), `Type: ${metadata.tableName}.${column.databaseName}`);
        assert.equal(actual.nullable, column.isNullable, `Nullability: ${metadata.tableName}.${column.databaseName}`);
        if (column.length) assert.equal(actual.maxLengthBytes, String(column.length).toLowerCase() === 'max' ? -1 : Number(column.length) * 2);
        if (column.collation) assert.equal(actual.collation, column.collation);
        if (column.type === 'datetime2') assert.equal(actual.scale, column.precision);
      }
      for (const index of metadata.indices) {
        const actual = schema.indexes.filter((item) => item.table === metadata.tableName && item.name === index.name).sort((a, b) => a.keyOrdinal - b.keyOrdinal);
        assert.deepEqual(actual.map((item) => item.column), index.columns.map((column) => column.databaseName), `Index: ${index.name}`);
        assert.equal(actual[0].isUnique, index.isUnique, `Index uniqueness: ${index.name}`);
        if (index.where) assert.equal(normalize(actual[0].filterDefinition), normalize(index.where));
      }
      for (const check of metadata.checks) assert.ok(schema.checks.some((item) => item.table === metadata.tableName && item.name === check.name), `Check: ${check.name}`);
      for (const key of metadata.foreignKeys) {
        const actual = schema.relationships.find((item) => item.sourceSchema === 'dbo' && item.sourceTable === metadata.tableName && item.sourceColumn === key.columnNames[0]);
        assert.ok(actual, `Foreign key: ${metadata.tableName}.${key.columnNames[0]}`);
        assert.equal(actual.targetTable, key.referencedTablePath.replace(/^dbo\./, ''));
        assert.equal(actual.targetColumn, key.referencedColumnNames[0]);
        assert.equal(actual.onDelete.replace(/_/g, ' '), key.onDelete);
      }
      assert.equal((await source.getRepository(metadata.target).createQueryBuilder('record').where('1 = 0').getMany()).length, 0);
    }
    assert.equal(schema.relationships.some((key) => key.sourceTable === 'contact_campaign_preferences' && key.sourceColumn === 'sourceContactId'), false);
    const contacts = source.getRepository(Contact).createQueryBuilder('contact')
      .leftJoinAndSelect('contact.contactType', 'contactType')
      .leftJoinAndSelect('contact.organization', 'organization')
      .leftJoinAndSelect('organization.organizationType', 'organizationType')
      .leftJoinAndSelect('organization.parentOrganization', 'parentOrganization')
      .where('1 = 0').orderBy('contact.contactName', 'ASC').addOrderBy('contact.id', 'ASC').take(1);
    const [rows, total] = await contacts.getManyAndCount();
    assert.equal(rows.length, 0);
    assert.equal(total, 0);
    assert.deepEqual(schema.evidenceColumns.map((column) => [column.column, column.type]), [
      ['connectionId', 'uniqueidentifier'], ['contactId', 'uniqueidentifier'], ['id', 'uniqueidentifier'], ['remoteJid', 'nvarchar'],
    ]);
    const evidence = await source.createQueryBuilder().select('conversation.id', 'conversationId')
      .addSelect('conversation.connectionId', 'connectionId').addSelect('conversation.remoteJid', 'whatsappIdentity')
      .from('dbo.whatsapp_conversations', 'conversation').where('1 = 0').orderBy('conversation.id', 'ASC').limit(1001).getRawMany();
    assert.equal(evidence.length, 0);
  } finally {
    if (source?.isInitialized) await source.destroy();
  }
  assert.equal(source.isInitialized, false);
});
