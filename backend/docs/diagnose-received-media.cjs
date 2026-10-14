// Read-only diagnostics: no migrations, writes, session access, or message content.
require('dotenv').config({ quiet: true });
const sql = require('mssql');
const fs = require('node:fs');
(async () => {
  const pool = await new sql.ConnectionPool({ server: process.env.DB_HOST, port: Number(process.env.DB_PORT), user: process.env.DB_USERNAME, password: process.env.DB_PASSWORD, database: process.env.DB_DATABASE, options: { encrypt: false, trustServerCertificate: true, useUTC: true } }).connect();
  try {
    const queries = {
      schema: "SELECT DB_NAME() databaseName, OBJECT_ID('dbo.whatsapp_message_media','U') mediaTableId; SELECT name FROM dbo.migrations ORDER BY id; SELECT name FROM sys.indexes WHERE object_id=OBJECT_ID('dbo.whatsapp_message_media'); SELECT name,is_disabled FROM sys.foreign_keys WHERE parent_object_id=OBJECT_ID('dbo.whatsapp_message_media');",
      connections: 'SELECT id,name,status,isActive,lastConnectedAt,lastDisconnectedAt,updatedAt FROM dbo.whatsapp_connections;',
      counts: 'SELECT messageType,fromMe,COUNT(*) total,MAX(createdAt) latest FROM dbo.whatsapp_messages GROUP BY messageType,fromMe; SELECT kind,availability,COUNT(*) total,MAX(createdAt) latest FROM dbo.whatsapp_message_media GROUP BY kind,availability;',
      media: 'SELECT TOP(30) m.id,m.conversationId,m.messageType,m.fromMe,m.messageTimestamp,m.createdAt,r.kind,r.availability,r.mimeType,r.sizeBytes,r.durationSeconds,r.createdAt mediaCreatedAt,r.updatedAt mediaUpdatedAt,CASE WHEN r.storageKey IS NULL THEN 0 ELSE 1 END hasStorageKey FROM dbo.whatsapp_messages m LEFT JOIN dbo.whatsapp_message_media r ON r.messageId=m.id WHERE m.messageType<>\'text\' ORDER BY m.createdAt DESC;',
      recent: 'SELECT TOP(12) id,conversationId,messageType,fromMe,messageTimestamp,createdAt FROM dbo.whatsapp_messages ORDER BY createdAt DESC;',
    };
    for (const [name, query] of Object.entries(queries)) {
      console.log(JSON.stringify({ name, recordsets: (await pool.request().query(query)).recordsets }));
    }
    const rows = (await pool.request().query('SELECT storageKey,sizeBytes FROM dbo.whatsapp_message_media WHERE storageKey IS NOT NULL')).recordset;
    const directory = process.env.WHATSAPP_MEDIA_DIR;
    console.log(JSON.stringify({ name: 'storage', configuredEnabled: process.env.WHATSAPP_MEDIA_ENABLED === 'true', directory, exists: !!directory && fs.existsSync(directory), entries: directory && fs.existsSync(directory) ? fs.readdirSync(directory).length : null, linkedFiles: rows.map(row => { const p = require('node:path').join(directory, row.storageKey); try { const s = fs.statSync(p); return { exists: s.isFile(), sizeMatches: s.size === row.sizeBytes }; } catch { return { exists: false }; } }) }));
  } finally { await pool.close(); }
})().catch(error => { console.error(error.code || error.name); process.exitCode = 1; });
