const { resolve } = require('node:path');
const { readFileSync } = require('node:fs');
const { ConfigService } = require('@nestjs/config');
const { parse } = require('dotenv');
const { validateEnvironment } = require('../dist/config/environment');
const { createDatabaseOptions, initializeDataSource } = require('../dist/config/database');

const tables = ['whatsapp_conversations', 'whatsapp_messages', 'whatsapp_message_media'];

async function readConversationSchema(source) {
  const parameters = tables.map((_table, index) => `@${index}`).join(',');
  const columns = await source.query(`
    SELECT s.name AS [schema], t.name AS [table], c.name AS [column], ty.name AS [type],
      c.max_length AS maxLengthBytes, c.precision, c.scale, c.is_nullable AS nullable,
      c.collation_name AS collation, dc.definition AS defaultDefinition
    FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id
    JOIN sys.columns c ON c.object_id = t.object_id
    JOIN sys.types ty ON ty.user_type_id = c.user_type_id
    LEFT JOIN sys.default_constraints dc ON dc.object_id = c.default_object_id
    WHERE s.name = 'dbo' AND t.name IN (${parameters}) ORDER BY t.name, c.column_id`, tables);
  const indexes = await source.query(`
    SELECT t.name AS [table], i.name, i.is_unique AS isUnique, i.is_primary_key AS isPrimaryKey,
      i.filter_definition AS filterDefinition, c.name AS [column], ic.key_ordinal AS keyOrdinal
    FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id
    JOIN sys.indexes i ON i.object_id = t.object_id
    JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
    JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
    WHERE s.name = 'dbo' AND t.name IN (${parameters}) AND ic.is_included_column = 0
    ORDER BY t.name, i.name, ic.key_ordinal`, tables);
  const relationships = await source.query(`
    SELECT fk.name, OBJECT_SCHEMA_NAME(fk.parent_object_id) AS sourceSchema,
      OBJECT_NAME(fk.parent_object_id) AS sourceTable, pc.name AS sourceColumn,
      OBJECT_SCHEMA_NAME(fk.referenced_object_id) AS targetSchema,
      OBJECT_NAME(fk.referenced_object_id) AS targetTable, rc.name AS targetColumn,
      fk.delete_referential_action_desc AS onDelete
    FROM sys.foreign_keys fk
    JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
    JOIN sys.columns pc ON pc.object_id = fkc.parent_object_id AND pc.column_id = fkc.parent_column_id
    JOIN sys.columns rc ON rc.object_id = fkc.referenced_object_id AND rc.column_id = fkc.referenced_column_id
    WHERE OBJECT_NAME(fk.parent_object_id) IN (${parameters}) OR OBJECT_NAME(fk.referenced_object_id) IN (${parameters})
    ORDER BY fk.name`, tables);
  const checks = await source.query(`
    SELECT OBJECT_NAME(parent_object_id) AS [table], name, definition
    FROM sys.check_constraints WHERE OBJECT_NAME(parent_object_id) IN (${parameters}) ORDER BY name`, tables);
  const connectionColumns = await source.query(`
    SELECT c.name AS [column], ty.name AS [type], c.max_length AS maxLengthBytes, c.is_nullable AS nullable
    FROM sys.columns c JOIN sys.types ty ON ty.user_type_id = c.user_type_id
    WHERE c.object_id = OBJECT_ID('dbo.whatsapp_connections')
      AND c.name IN ('id', 'isActive') ORDER BY c.name`);
  return { columns, indexes, relationships, checks, connectionColumns };
}

async function main() {
  let source;
  let stage = 'environment';
  try {
    const values = { ...parse(readFileSync(resolve(__dirname, '../.env'))), ...process.env };
    const config = new ConfigService(validateEnvironment(values));
    stage = 'initialize';
    source = await initializeDataSource({ ...createDatabaseOptions(config), requestTimeout: 30000 });
    stage = 'metadata';
    let queryIndex = 0;
    const trackedSource = { query: (sql, parameters) => {
      stage = ['columns', 'indexes', 'relationships', 'checks', 'evidence'][queryIndex++];
      return source.query(sql, parameters);
    } };
    console.log(JSON.stringify(await readConversationSchema(trackedSource)));
  } catch (error) {
    console.error(JSON.stringify({
      error: 'Falha na consulta de metadados dos conversas; dados sensiveis omitidos.',
      sqlCode: Number.isInteger(error?.driverError?.number) ? error.driverError.number : null,
      initializationFailed: error?.message?.startsWith('SQL_INIT_FAILED') === true,
      stage,
      invalidKey: error?.message?.match(/^Configuracao invalida: (\w+)/)?.[1] ?? null,
      errorType: ['TypeError', 'QueryFailedError', 'Error'].includes(error?.name) ? error.name : 'other',
      driverCode: /^[A-Z_]{2,32}$/.test(error?.driverError?.code ?? '') ? error.driverError.code : null,
    }));
    process.exitCode = 1;
  } finally {
    if (source?.isInitialized) await source.destroy();
  }
}
module.exports = { tables, readConversationSchema };
if (require.main === module) void main();
