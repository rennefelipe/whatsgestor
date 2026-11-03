// Offline generator for review. Never initialize a DataSource or connect to SQL.
const fs=require('node:fs'),path=require('node:path');
const {DataSource,Table,TableForeignKey}=require('typeorm'),{ConfigService}=require('@nestjs/config');
const {createDatabaseOptions}=require('../dist/config/database');
(async()=>{
 const source=new DataSource({...createDatabaseOptions(new ConfigService({DB_HOST:'offline.invalid',DB_PORT:1433,DB_USERNAME:'offline',DB_PASSWORD:'unused',DB_DATABASE:'offline',DB_ENCRYPT:true,DB_TRUST_SERVER_CERTIFICATE:false})),schema:'dbo'});
 await source.buildMetadatas();const runner=source.createQueryRunner();
 const sql=[`CREATE TABLE [dbo].[whatsapp_connections] ([id] uniqueidentifier NOT NULL DEFAULT NEWID() PRIMARY KEY, [name] nvarchar(150) NOT NULL, [phoneNumber] nvarchar(30) NULL, [status] nvarchar(30) NOT NULL DEFAULT N'disconnected', [isActive] bit NOT NULL DEFAULT 1, [createdAt] datetime2(7) NOT NULL DEFAULT SYSUTCDATETIME(), [updatedAt] datetime2(7) NOT NULL DEFAULT SYSUTCDATETIME(), [lastConnectedAt] datetime2(7) NULL, [lastDisconnectedAt] datetime2(7) NULL)`];
 const tables=source.entityMetadatas.map(meta=>({meta,table:Table.create(meta,source.driver)}));
 for(const {table}of tables){sql.push(runner.createTableSql(table,false).query);for(const index of table.indices)sql.push(runner.createIndexSql(table,index).query);}
 for(const {meta,table}of tables)for(const fk of meta.foreignKeys)sql.push(runner.createForeignKeySql(table,TableForeignKey.create(fk,source.driver)).query);
 sql.push('ALTER TABLE [dbo].[whatsapp_conversations] ADD CONSTRAINT [FK_v1_conversation_connection] FOREIGN KEY ([connectionId]) REFERENCES [dbo].[whatsapp_connections]([id]) ON DELETE NO ACTION');
 sql.push('ALTER TABLE [dbo].[whatsapp_messages] ADD CONSTRAINT [FK_v1_message_conversation] FOREIGN KEY ([conversationId]) REFERENCES [dbo].[whatsapp_conversations]([id]) ON DELETE NO ACTION');
 for(const [name,expression]of Object.entries({kind:"[kind] IN (N'image',N'document',N'audio')",availability:"[availability] IN (N'pending',N'ready',N'failed')",size:'[sizeBytes] IS NULL OR [sizeBytes] BETWEEN 1 AND 20971520',duration:'[durationSeconds] IS NULL OR [durationSeconds]>=0'}))sql.push(`ALTER TABLE [dbo].[whatsapp_message_media] ADD CONSTRAINT [CK_whatsapp_message_media_${name}] CHECK (${expression})`);
 sql.push("INSERT INTO [dbo].[contact_display_settings] ([fieldKey],[isVisible],[displayOrder]) VALUES (N'group',1,1),(N'shopping',1,2),(N'store',1,3),(N'contactType',1,4),(N'contactName',1,5)");
 const names=['whatsapp_connections',...source.entityMetadatas.map(m=>m.tableName)];
 const columns=Object.fromEntries(source.entityMetadatas.map(m=>[m.tableName,m.columns.map(c=>c.databaseName)]));
 const output=path.resolve(__dirname,'../src/database/migrations/schema-v1.ts');fs.mkdirSync(path.dirname(output),{recursive:true});
 const generated='// Frozen v1 baseline. Regeneration requires migration review; no runtime schema synchronization.\n'+`export const TABLES_V1 = ${JSON.stringify(names,null,2)} as const;\nexport const COLUMNS_V1 = ${JSON.stringify(columns,null,2)} as const;\nexport const SQL_V1: readonly string[] = ${JSON.stringify(sql,null,2)};\n`;
 if(fs.existsSync(output)&&!process.argv.includes('--replace-reviewed'))throw Error('BASELINE_EXISTS_REVIEW_REQUIRED');
 fs.writeFileSync(output,generated);console.log(JSON.stringify({offline:true,tables:names.length,statements:sql.length}));
})().catch(()=>{console.error('BASELINE_GENERATION_FAILED');process.exitCode=1;});
