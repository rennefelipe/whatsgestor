const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
require('dotenv').config({ quiet: true });
const sql = require('mssql');
const expected = [
 'CreateOrganizationStructure1791406381932','CreateContactStructure1791406993032',
 'CreateUserStructure1791408136923','CreateContactDisplaySettings1791408335715',
 'CreateWhatsappConnections1791439200000','CreateWhatsappConversationsAndMessages1791485910429',
 'LinkWhatsappConversationsToContacts1791493160976','AddWhatsappConversationAttendance1791540000000',
];
const target='AddWhatsappMessageMedia1791600000000';
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const report={startedAt:new Date().toISOString(),target,backupValidated:false};
const reportPath=path.join(__dirname,'media-backup-result.json');
(async()=>{
 const pool=await new sql.ConnectionPool({server:process.env.DB_HOST,port:Number(process.env.DB_PORT),user:process.env.DB_USERNAME,password:process.env.DB_PASSWORD,database:process.env.DB_DATABASE,requestTimeout:600000,options:{encrypt:false,trustServerCertificate:true,useUTC:true}}).connect();
 try {
  const initial=await pool.request().query("SELECT DB_NAME() AS databaseName, CAST(SERVERPROPERTY('ServerName') AS nvarchar(128)) AS serverName, CAST(SERVERPROPERTY('ProductVersion') AS nvarchar(128)) AS version; SELECT name FROM dbo.migrations ORDER BY id;");
  report.server=initial.recordsets[0][0];
  if(report.server.databaseName!=='WhatsGestor'||report.server.serverName!=='DESKTOP-T3R6HCI'||report.server.version!=='16.0.1000.6')throw new Error('Database/server differs from reviewed target');
  if(process.env.WHATSAPP_MEDIA_ENABLED==='true')throw new Error('Media must remain disabled');
  if(JSON.stringify(initial.recordsets[1].map(row=>row.name))!==JSON.stringify(expected))throw new Error('Applied migrations differ from approved eight');
  require('ts-node/register');
  const source=require('../src/database/data-source').default;
  if(source.options.synchronize!==false)throw new Error('synchronize must remain false');
  if(!/synchronize:\s*false/.test(fs.readFileSync('src/app.module.ts','utf8')))throw new Error('Runtime synchronize is not disabled');
  source.setOptions({migrationsRun:false,logging:false});
  await source.initialize();
  try {const {MigrationExecutor}=require('typeorm');const pending=await new MigrationExecutor(source).getPendingMigrations();if(pending.length!==1||pending[0].name!==target)throw new Error('Only the approved media migration may be pending');report.pendingMigrations=pending.map(item=>item.name);}finally{await source.destroy();}
  report.migrationHash=hash('src/database/migrations/1791600000000-AddWhatsappMessageMedia.ts');
  report.backupScriptHash=hash('docs/media-migration-backup.sql');
  console.log('Initial verification passed: approved server, WhatsGestor, 8 applied, only media pending, synchronize=false, media disabled.');
  const script=fs.readFileSync('docs/media-migration-backup.sql','utf8');
  const batches=script.split(/^\s*GO\s*$/im).filter(batch=>batch.trim());
  const information=[];let file;
  for(const batch of batches){const request=pool.request();request.on('info',event=>{information.push(event.message);console.log(event.message);});const result=await request.batch(batch);for(const set of result.recordsets??[])for(const row of set)if(row.BackupFile)file=row.BackupFile;}
  if(!file)throw new Error('Backup script did not report a validated backup file');
  const evidence=await pool.request().input('file',sql.NVarChar(4000),file).query("SELECT TOP(1) b.database_name AS databaseName,b.type,b.is_copy_only AS copyOnly,b.has_backup_checksums AS checksum,b.is_damaged AS damaged,b.backup_start_date AS startedAt,b.backup_finish_date AS finishedAt,b.backup_size AS sizeBytes,m.physical_device_name AS file FROM msdb.dbo.backupset b JOIN msdb.dbo.backupmediafamily m ON m.media_set_id=b.media_set_id WHERE m.physical_device_name=@file ORDER BY b.backup_set_id DESC;");
  const backup=evidence.recordset[0];if(!backup||backup.databaseName!=='WhatsGestor'||backup.type!=='D'||!backup.copyOnly||!backup.checksum||backup.damaged||!backup.finishedAt)throw new Error('Backup metadata failed verification');
  report.backup=backup;report.verificationMessages=information;report.backupValidated=true;report.finishedAt=new Date().toISOString();
  fs.writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n','utf8');
  console.log(JSON.stringify({backupValidated:true,backup,report:reportPath}));
 } finally {await pool.close();}
})().catch(error=>{report.error=error.message;fs.writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n','utf8');console.error('Backup procedure stopped: '+error.message);process.exitCode=1;});
