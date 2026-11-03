// Metadata only: no user records, passwords or environment values are returned.
const { resolve } = require('node:path');
const { readFileSync } = require('node:fs');
const { ConfigService } = require('@nestjs/config');
const { parse } = require('dotenv');
const { validateEnvironment } = require('../dist/config/environment');
const { createDatabaseOptions, initializeDataSource } = require('../dist/config/database');

async function readUsersSchema(source) {
  const columns = await source.query(`
    SELECT s.name AS [schema], t.name AS [table], c.name AS [column],
      ty.name AS [type], c.max_length AS maxLengthBytes, c.precision,
      c.scale, c.is_nullable AS nullable, c.is_identity AS isIdentity,
      dc.definition AS defaultDefinition
    FROM sys.tables t
    JOIN sys.schemas s ON s.schema_id = t.schema_id
    JOIN sys.columns c ON c.object_id = t.object_id
    JOIN sys.types ty ON ty.user_type_id = c.user_type_id
    LEFT JOIN sys.default_constraints dc ON dc.object_id = c.default_object_id
    WHERE t.name = 'users'
    ORDER BY s.name, c.column_id`);
  const indexes = await source.query(`
    SELECT s.name AS [schema], i.name, i.is_unique AS isUnique,
      i.is_primary_key AS isPrimaryKey, c.name AS [column], ic.key_ordinal AS keyOrdinal
    FROM sys.tables t
    JOIN sys.schemas s ON s.schema_id = t.schema_id
    JOIN sys.indexes i ON i.object_id = t.object_id
    JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
    JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
    WHERE t.name = 'users' AND ic.is_included_column = 0
    ORDER BY s.name, i.name, ic.key_ordinal`);
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
    WHERE OBJECT_NAME(fk.parent_object_id) = 'users' OR OBJECT_NAME(fk.referenced_object_id) = 'users'
    ORDER BY fk.name`);
  return { columns, indexes, relationships };
}

async function main() {
  let source;
  try {
    const values = { ...parse(readFileSync(resolve(__dirname, '../.env'))), ...process.env };
    const config = new ConfigService(validateEnvironment(values));
    source = await initializeDataSource(createDatabaseOptions(config));
    console.log(JSON.stringify(await readUsersSchema(source), null, 2));
    console.log(JSON.stringify({
      jwtSecretConfigured: typeof values.JWT_SECRET === 'string' && values.JWT_SECRET.trim().length >= 32,
      jwtExpirationValid: values.JWT_EXPIRES_IN === undefined ||
        (/^\d+$/.test(values.JWT_EXPIRES_IN) && Number.isSafeInteger(Number(values.JWT_EXPIRES_IN)) && Number(values.JWT_EXPIRES_IN) > 0),
    }));
  } catch {
    console.error('Falha na consulta de metadados de usuarios; nenhum detalhe sensivel foi registrado.');
    process.exitCode = 1;
  } finally {
    if (source?.isInitialized) await source.destroy();
  }
}

module.exports = { readUsersSchema };
if (require.main === module) void main();
