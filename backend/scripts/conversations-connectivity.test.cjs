const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolve } = require('node:path');
const { readFileSync } = require('node:fs');
const { parse } = require('dotenv');
const { ConfigService } = require('@nestjs/config');
const { validateEnvironment } = require('../dist/config/environment');
const { createDatabaseOptions, initializeDataSource } = require('../dist/config/database');
const { readConversationSchema, tables } = require('./inspect-conversation-schema.cjs');
const { WhatsappConversation } = require('../dist/whatsapp-conversations/entities/whatsapp-conversation.entity');
const { WhatsappMessage } = require('../dist/whatsapp-conversations/entities/whatsapp-message.entity');
const { User } = require('../dist/users/entities/user.entity');
const { conversationQuery } = require('../dist/whatsapp-conversations/conversation-query');
const normalize = (value) => value.replace(/[\s()[\]]/g, '').toLowerCase();

test('conversation metadata, uniqueness, chronological queries and lock SQL match existing SQL without writes', async () => {
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
    const schema = await readConversationSchema(source);
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
        // TypeORM 0.3 also synthesizes REL_* for OneToOne. The existing named
        // unique index on precisely messageId already enforces this constraint.
        const synthesizedMediaIndex = metadata.tableName === 'whatsapp_message_media' && index.name.startsWith('REL_') &&
          index.isUnique && index.columns.length === 1 && index.columns[0].databaseName === 'messageId' &&
          index.columns[0].isNullable === false;
        const physicalName = synthesizedMediaIndex ? 'UQ_whatsapp_message_media_messageId' : index.name;
        const actual = schema.indexes.filter((item) => item.table === metadata.tableName && item.name === physicalName).sort((a, b) => a.keyOrdinal - b.keyOrdinal);
        assert.deepEqual(actual.map((item) => item.column), index.columns.map((column) => column.databaseName), `Index: ${index.name}`);
        assert.equal(actual[0].isUnique, index.isUnique, `Index uniqueness: ${index.name}`);
        if (index.where) {
          if (synthesizedMediaIndex && actual[0].filterDefinition === null) {
            // TypeORM adds this filter to its synthesized OneToOne index even
            // for NOT NULL messageId. The existing unfiltered unique index is
            // equivalent because this predicate excludes no possible row.
            assert.equal(normalize(index.where), '"messageid"isnotnull');
          } else {
            assert.equal(typeof actual[0].filterDefinition, 'string', `Missing index filter: ${index.name}`);
            assert.equal(normalize(actual[0].filterDefinition), normalize(index.where));
          }
        }
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
    assert.ok(schema.relationships.some((key) => key.sourceTable === 'whatsapp_conversations' && key.sourceColumn === 'connectionId' && key.targetTable === 'whatsapp_connections'));
    assert.ok(schema.relationships.some((key) => key.sourceTable === 'whatsapp_messages' && key.sourceColumn === 'conversationId' && key.targetTable === 'whatsapp_conversations'));
    const repository = source.getRepository(WhatsappConversation);
    const conversations = conversationQuery(repository).where('1 = 0')
      .orderBy('conversation.lastMessageAt', 'DESC').addOrderBy('conversation.createdAt', 'DESC')
      .addOrderBy('conversation.id', 'ASC').take(1);
    assert.equal(conversations.getSql().includes('passwordHash'), false);
    assert.equal((await conversations.getManyAndCount())[1], 0);
    const history = source.getRepository(WhatsappMessage).createQueryBuilder('message')
      .leftJoin('message.media', 'media')
      .addSelect(['media.id', 'media.kind', 'media.availability', 'media.mimeType', 'media.originalName', 'media.sizeBytes', 'media.durationSeconds'])
      .where('1 = 0').addSelect('CASE WHEN message.messageTimestamp IS NULL THEN 1 ELSE 0 END', 'message_timestamp_missing')
      .orderBy('message_timestamp_missing', 'ASC').addOrderBy('message.messageTimestamp', 'ASC')
      .addOrderBy('message.createdAt', 'ASC').addOrderBy('message.id', 'ASC').take(1);
    assert.equal(history.getSql().includes('storageKey'), false);
    assert.equal((await history.getManyAndCount())[1], 0);
    // Generate lock SQL without executing it or opening live transactions.
    assert.match(repository.createQueryBuilder('conversation').setLock('pessimistic_write').getSql(), /UPDLOCK/);
    assert.match(source.getRepository(User).createQueryBuilder('actor').setLock('pessimistic_read').getSql(), /HOLDLOCK/);
    assert.deepEqual(schema.connectionColumns.map((column) => [column.column, column.type]), [['id', 'uniqueidentifier'], ['isActive', 'bit']]);
    const connections = await source.createQueryBuilder().select('connection.id', 'id')
      .from('dbo.whatsapp_connections', 'connection').where('1 = 0').getRawMany();
    assert.equal(connections.length, 0);
  } finally {
    if (source?.isInitialized) await source.destroy();
  }
  assert.equal(source.isInitialized, false);
});
