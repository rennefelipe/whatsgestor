const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
require('dotenv').config({quiet:true});
require('ts-node/register');
const {MigrationExecutor}=require('typeorm');
const source=require('../src/database/data-source').default;
const target='AddWhatsappMessageMedia1791600000000';
const priorNames=[
'CreateOrganizationStructure1791406381932','CreateContactStructure1791406993032',
'CreateUserStructure1791408136923','CreateContactDisplaySettings1791408335715',
'CreateWhatsappConnections1791439200000','CreateWhatsappConversationsAndMessages1791485910429',
'LinkWhatsappConversationsToContacts1791493160976','AddWhatsappConversationAttendance1791540000000'];
const report={startedAt:new Date().toISOString(),target,backupValidation:{confirmedBy:'user',message:'O conjunto de backup no arquivo 1 e valido.',independentlyVerifiedByAgent:false},migrationCommitted:false};
const reportFile=path.join(__dirname,'media-migration-applied-result.json');
const persist=()=>fs.writeFileSync(reportFile,JSON.stringify(report,null,2)+'\n','utf8');
const digest=data=>crypto.createHash('sha256').update(data).digest('hex');
function mediaDisabled(){return process.env.WHATSAPP_MEDIA_ENABLED!=='true' && require('dotenv').parse(fs.readFileSync('.env')).WHATSAPP_MEDIA_ENABLED!=='true';}
function assert(condition,message){if(!condition)throw new Error(message);}
async function fingerprint(runner,table){
 const rows=await runner.query(`SELECT [currentRow].[id], (SELECT [currentRow].* FOR JSON PATH, INCLUDE_NULL_VALUES, WITHOUT_ARRAY_WRAPPER) AS [serialized] FROM [dbo].[${table}] AS [currentRow] WITH (TABLOCK,HOLDLOCK) ORDER BY [currentRow].[id]`);
 return {count:rows.length,sha256:digest(rows.map(row=>row.id+':'+digest(row.serialized)).join('\n'))};
}
async function metadata(runner){
 return {
 columns:await runner.query("SELECT c.name,t.name AS type,c.max_length AS maxLength,c.is_nullable AS nullable FROM sys.columns c JOIN sys.types t ON c.user_type_id=t.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.whatsapp_message_media') ORDER BY c.column_id"),
 indexes:await runner.query("SELECT i.name,i.is_unique AS isUnique,i.is_primary_key AS isPrimaryKey,c.name AS columnName,ic.key_ordinal AS keyOrdinal FROM sys.indexes i JOIN sys.index_columns ic ON i.object_id=ic.object_id AND i.index_id=ic.index_id JOIN sys.columns c ON c.object_id=ic.object_id AND c.column_id=ic.column_id WHERE i.object_id=OBJECT_ID(N'dbo.whatsapp_message_media') ORDER BY i.name,ic.key_ordinal"),
 foreignKeys:await runner.query("SELECT fk.name,OBJECT_NAME(fk.parent_object_id) AS parentTable,pc.name AS parentColumn,OBJECT_NAME(fk.referenced_object_id) AS referencedTable,rc.name AS referencedColumn,fk.delete_referential_action_desc AS onDelete,fk.is_disabled AS disabled,fk.is_not_trusted AS notTrusted FROM sys.foreign_keys fk JOIN sys.foreign_key_columns fc ON fk.object_id=fc.constraint_object_id JOIN sys.columns pc ON pc.object_id=fc.parent_object_id AND pc.column_id=fc.parent_column_id JOIN sys.columns rc ON rc.object_id=fc.referenced_object_id AND rc.column_id=fc.referenced_column_id WHERE fk.parent_object_id=OBJECT_ID(N'dbo.whatsapp_message_media')"),
 checks:await runner.query("SELECT name,is_disabled AS disabled,is_not_trusted AS notTrusted FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID(N'dbo.whatsapp_message_media')"),
 defaults:await runner.query("SELECT c.name AS columnName,d.definition FROM sys.default_constraints d JOIN sys.columns c ON c.object_id=d.parent_object_id AND c.column_id=d.parent_column_id WHERE d.parent_object_id=OBJECT_ID(N'dbo.whatsapp_message_media')"),
 };
}
(async()=>{
 assert(source.options.synchronize===false,'synchronize must remain false');
 assert(/synchronize:\s*false/.test(fs.readFileSync('src/app.module.ts','utf8')),'Application synchronize must remain false');
 assert(mediaDisabled(),'Media must remain disabled');
 const prior=JSON.parse(fs.readFileSync('docs/media-backup-result.json','utf8'));
 report.backupFile=prior.backupHistory[0].backupFile;
 assert(digest(fs.readFileSync('src/database/migrations/1791600000000-AddWhatsappMessageMedia.ts'))===prior.migrationHash,'Migration changed since backup/review');
 source.setOptions({logging:false,migrationsRun:false});
 await source.initialize();
 const runner=source.createQueryRunner();
 try {
  await runner.connect();
  const identity=(await runner.query("SELECT DB_NAME() AS databaseName, CAST(SERVERPROPERTY('ServerName') AS nvarchar(128)) AS serverName, CAST(SERVERPROPERTY('ProductVersion') AS nvarchar(128)) AS version"))[0];
  assert(identity.databaseName==='WhatsGestor' && identity.serverName==='DESKTOP-T3R6HCI','Unexpected database/server');
  report.identity=identity;
  const executor=new MigrationExecutor(source,runner);executor.transaction='all';
  const applied=await executor.getExecutedMigrations();const pending=await executor.getPendingMigrations();
  assert(applied.length===8 && priorNames.every(name=>applied.some(item=>item.name===name)),'Expected exactly eight approved migrations applied');
  assert(pending.length===1 && pending[0].name===target,'Only the approved media migration may be pending');
  assert((await runner.query("SELECT OBJECT_ID(N'dbo.whatsapp_message_media',N'U') AS id"))[0].id===null,'Media table already exists');
  report.initial={applied:applied.map(item=>item.name),pending:pending.map(item=>item.name),synchronize:false,mediaEnabled:false};persist();
  console.log('Initial verification passed: DESKTOP-T3R6HCI / WhatsGestor; eight applied, media only pending; synchronize=false; media disabled.');
  // Hold read locks only for the short DDL transaction, preserving an exact before/after comparison.
  await runner.startTransaction();
  const migrationRows=await runner.query('SELECT name FROM dbo.migrations WITH (TABLOCK,HOLDLOCK) ORDER BY id');
  assert(JSON.stringify(migrationRows.map(row=>row.name))===JSON.stringify(priorNames),'Migration state changed');
  report.before={conversations:await fingerprint(runner,'whatsapp_conversations'),messages:await fingerprint(runner,'whatsapp_messages')};
  const tablesBefore=await runner.query("SELECT s.name AS schemaName,t.name FROM sys.tables t JOIN sys.schemas s ON t.schema_id=s.schema_id ORDER BY s.name,t.name");
  const executed=await executor.executePendingMigrations();
  assert(executed.length===1 && executed[0].name===target,'Unexpected executed migration');
  report.structure=await metadata(runner);
  const expectedColumns=[['id','uniqueidentifier',16,false],['messageId','uniqueidentifier',16,false],['kind','nvarchar',40,false],['availability','nvarchar',40,false],['mimeType','nvarchar',200,false],['originalName','nvarchar',510,true],['sizeBytes','int',4,true],['durationSeconds','int',4,true],['storageKey','nvarchar',128,true],['createdAt','datetime2',8,false],['updatedAt','datetime2',8,false]];
  assert(JSON.stringify(report.structure.columns.map(c=>[c.name,c.type,c.maxLength,Boolean(c.nullable)]))===JSON.stringify(expectedColumns),'Unexpected media columns');
  assert(report.structure.indexes.some(i=>i.isPrimaryKey && i.columnName==='id'),'Missing media primary key');
  assert(report.structure.indexes.some(i=>i.name==='UQ_whatsapp_message_media_messageId' && i.isUnique && i.columnName==='messageId'),'Missing unique messageId index');
  assert(report.structure.foreignKeys.length===1 && report.structure.foreignKeys[0].referencedTable==='whatsapp_messages' && report.structure.foreignKeys[0].referencedColumn==='id' && report.structure.foreignKeys[0].parentColumn==='messageId' && report.structure.foreignKeys[0].onDelete==='NO_ACTION' && !report.structure.foreignKeys[0].disabled && !report.structure.foreignKeys[0].notTrusted,'Unexpected foreign key');
  assert(report.structure.checks.length===4 && report.structure.checks.every(c=>!c.disabled && !c.notTrusted),'Missing/disabled check constraints');
  assert(report.structure.defaults.length===4,'Missing defaults');
  const tablesAfter=await runner.query("SELECT s.name AS schemaName,t.name FROM sys.tables t JOIN sys.schemas s ON t.schema_id=s.schema_id ORDER BY s.name,t.name");
  assert(JSON.stringify(tablesAfter.filter(t=>!(t.schemaName==='dbo' && t.name==='whatsapp_message_media')))===JSON.stringify(tablesBefore),'Unexpected table changes');
  report.after={conversations:await fingerprint(runner,'whatsapp_conversations'),messages:await fingerprint(runner,'whatsapp_messages')};
  assert(JSON.stringify(report.before)===JSON.stringify(report.after),'Existing conversation/message rows changed');
  const finalApplied=await executor.getExecutedMigrations();
  assert(finalApplied.length===9 && finalApplied.some(m=>m.name===target),'Expected nine migrations applied');
  assert((await executor.getPendingMigrations()).length===0,'Unexpected pending migration');
  assert(mediaDisabled(),'Media enabled unexpectedly');
  report.appliedMigrations=finalApplied.map(m=>m.name);report.existingRowsPreserved=true;
  await runner.commitTransaction();report.migrationCommitted=true;persist();
  report.postCommit={migrations:(await runner.query('SELECT COUNT(*) AS total FROM dbo.migrations'))[0].total,mediaRows:(await runner.query('SELECT COUNT(*) AS total FROM dbo.whatsapp_message_media'))[0].total,mediaEnabled:!mediaDisabled()};
  report.finishedAt=new Date().toISOString();persist();
  console.log(JSON.stringify({migrationCommitted:true,target,identity,preservedCounts:{conversations:report.after.conversations.count,messages:report.after.messages.count},existingRowsPreserved:true,postCommit:report.postCommit,reportFile}));
 }catch(error){
  if(runner.isTransactionActive)await runner.rollbackTransaction();
  report.error=error.message;report.finishedAt=new Date().toISOString();persist();throw error;
 }finally{await runner.release();await source.destroy();}
})().catch(error=>{report.error=error.message;persist();console.error('Controlled migration stopped: '+error.message);process.exitCode=1;});
