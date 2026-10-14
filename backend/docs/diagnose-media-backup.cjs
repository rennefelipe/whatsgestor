const fs = require('node:fs');
const path = require('node:path');
require('dotenv').config({ quiet: true });
const sql = require('mssql');
const previous = JSON.parse(fs.readFileSync(path.join(__dirname, 'media-backup-result.json'), 'utf8'));
const backupFile = previous.backupHistory?.[0]?.backupFile;
if (!backupFile || !backupFile.endsWith('WhatsGestor_pre_media_20261009_175942_B466782F.bak')) throw new Error('Unexpected backup file');
const report = { startedAt: new Date().toISOString(), backupFile, checks: [], migrationsExecuted: false, permissionsChanged: false, mediaEnabled: process.env.WHATSAPP_MEDIA_ENABLED === 'true' };
function detail(error) {
  const info = error.originalError?.info ?? error.info ?? error;
  return { number: info.number ?? error.number, state: info.state ?? error.state, severity: info.class ?? error.class, lineNumber: info.lineNumber ?? error.lineNumber, serverName: info.serverName ?? error.serverName, message: String(info.message ?? error.message).replaceAll(process.env.DB_USERNAME || '__unused__', '[conta SQL]') };
}
(async () => {
 const pool = await new sql.ConnectionPool({ server: process.env.DB_HOST, port: Number(process.env.DB_PORT), user: process.env.DB_USERNAME, password: process.env.DB_PASSWORD, database: process.env.DB_DATABASE, requestTimeout: 120000, options: { encrypt: false, trustServerCertificate: true, useUTC: true } }).connect();
 try {
  async function check(name, query, file = false) {
   const request = pool.request();
   if (file) request.input('backupFile', sql.NVarChar(4000), backupFile);
   const messages = []; request.on('info', message => messages.push(detail(message)));
   try {
    const result = await request.query(query);
    const entry = { name, succeeded: true, recordsets: result.recordsets, messages };
    report.checks.push(entry); console.log(JSON.stringify(entry));
   } catch (error) {
    const errors = [...(error.precedingErrors ?? []).map(detail), detail(error)];
    const entry = { name, succeeded: false, errors, messages };
    report.checks.push(entry); console.log(JSON.stringify(entry));
   }
  }
  await check('identity_and_permissions', "SELECT DB_NAME() AS databaseName, CAST(SERVERPROPERTY('ServerName') AS nvarchar(128)) AS serverName, CAST(SERVERPROPERTY('ProductVersion') AS nvarchar(128)) AS version, IS_SRVROLEMEMBER('sysadmin') AS sysadmin, IS_SRVROLEMEMBER('dbcreator') AS dbcreator, HAS_PERMS_BY_NAME(NULL,NULL,'CREATE ANY DATABASE') AS createAnyDatabase, HAS_PERMS_BY_NAME(N'master',N'DATABASE',N'CREATE DATABASE') AS masterCreateDatabase; SELECT COUNT(*) AS appliedMigrations FROM dbo.migrations; SELECT OBJECT_ID(N'dbo.whatsapp_message_media',N'U') AS mediaTableId;");
  const identity = report.checks[0].recordsets?.[0]?.[0];
  if (identity?.databaseName !== 'WhatsGestor' || identity?.serverName !== 'DESKTOP-T3R6HCI') throw new Error('Unexpected SQL Server or database');
  await check('sql_service_file_exists', 'EXEC master.dbo.xp_fileexist @backupFile;', true);
  await check('verify_backup_checksums', 'RESTORE VERIFYONLY FROM DISK = @backupFile WITH CHECKSUM;', true);
  if (identity.sysadmin === 1 || identity.dbcreator === 1 || identity.createAnyDatabase === 1 || identity.masterCreateDatabase === 1) {
    await check('backup_header', 'RESTORE HEADERONLY FROM DISK = @backupFile;', true);
  } else report.checks.push({ name: 'backup_header', skipped: true, reason: 'No CREATE DATABASE permission; HEADERONLY requires it too.' });
 } finally { await pool.close(); }
 report.finishedAt = new Date().toISOString();
 fs.writeFileSync(path.join(__dirname, 'media-backup-diagnostic.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
})().catch(error => { report.error = detail(error); fs.writeFileSync(path.join(__dirname, 'media-backup-diagnostic.json'), JSON.stringify(report, null, 2) + '\n', 'utf8'); console.error(JSON.stringify(report.error)); process.exitCode = 1; });
