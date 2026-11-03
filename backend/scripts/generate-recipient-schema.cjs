// Offline only. Uses metadata and SQL rendering, never initializes a connection.
const fs=require('node:fs'),path=require('node:path');
require('ts-node').register({project:path.join(__dirname,'../tsconfig.json')});
const {DataSource,Table,TableForeignKey}=require('typeorm');
const {recipientSelectionEntities}=require('../src/bulk-send/entities/recipient-selection.entity');
(async()=>{
 const output=path.join(__dirname,'../src/database/migrations/schema-recipient-selections.ts');
 if(fs.existsSync(output))throw Error('FROZEN_SCHEMA_EXISTS_REVIEW_REQUIRED');
 const source=new DataSource({type:'mssql',schema:'dbo',entities:recipientSelectionEntities});
 await source.buildMetadatas();const runner=source.createQueryRunner();
 const tables=source.entityMetadatas.map(meta=>({meta,table:Table.create(meta,source.driver)})),sql=[];
 for(const {table}of tables){sql.push(runner.createTableSql(table,false).query);for(const index of table.indices)sql.push(runner.createIndexSql(table,index).query);}
 for(const {meta,table}of tables)for(const fk of meta.foreignKeys)sql.push(runner.createForeignKeySql(table,TableForeignKey.create(fk,source.driver)).query);
 const names=tables.map(({table})=>table.name);
 const columns=Object.fromEntries(source.entityMetadatas.map(meta=>[meta.tableName,meta.columns.map(column=>column.databaseName)]));
 fs.writeFileSync(output,'// Frozen additive schema; generated offline. Never regenerate an applied migration.\n'+`export const RECIPIENT_TABLES = ${JSON.stringify(names,null,2)} as const;\nexport const RECIPIENT_COLUMNS = ${JSON.stringify(columns,null,2)} as const;\nexport const RECIPIENT_SQL: readonly string[] = ${JSON.stringify(sql,null,2)};\n`,{flag:'wx'});
 console.log(JSON.stringify({offline:true,tables:names.length,statements:sql.length}));
})().catch(error=>{console.error(error.message);process.exitCode=1;});
