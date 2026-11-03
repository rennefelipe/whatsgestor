const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { resolve } = require('node:path');
const { parse } = require('dotenv');
const { ConfigService } = require('@nestjs/config');
const { createDatabaseOptions, initializeDataSource } = require('../dist/config/database');
const { validateEnvironment } = require('../dist/config/environment');
const { FilePolicy } = require('../dist/messages/file-policy');
const { PrivateFileStorage } = require('../dist/messages/private-file-storage');
const { MessageFilesService } = require('../dist/messages/message-files.service');

test('message/file compatibility uses SELECT only, preserves SQL checks and verifies historical files without rewriting them', async(t)=>{
  const values = { ...parse(fs.readFileSync(resolve(__dirname,'../.env'))), ...process.env };
  const config = new ConfigService(validateEnvironment(values));
  let source;
  try {
    source = await initializeDataSource({ ...createDatabaseOptions(config), requestTimeout:30000 });
    const create = source.createQueryRunner.bind(source);
    source.createQueryRunner = (...args) => {
      const runner = create(...args), query = runner.query.bind(runner);
      runner.query = (sql,...params) => { assert.match(sql.trim(),/^SELECT\b/i,'Read-only verification'); return query(sql,...params); };
      return runner;
    };
    assert.equal(source.options.synchronize,false); assert.equal(source.options.migrationsRun,false);
    const checks = await source.query("SELECT name,definition,is_disabled AS disabled,is_not_trusted AS untrusted FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID('dbo.whatsapp_message_media')");
    const size = checks.find(x=>x.name==='CK_whatsapp_message_media_size');
    assert.ok(size && !size.disabled && !size.untrusted);
    assert.match(size.definition,/20971520/);
    const kind = checks.find(x=>x.name==='CK_whatsapp_message_media_kind');
    assert.ok(kind && !kind.disabled && !kind.untrusted);
    for (const value of ['image','audio','document']) assert.ok(kind.definition.includes(value));
    assert.equal(kind.definition.includes('video'),false);
    const policy = new FilePolicy(config), storage = new PrivateFileStorage(policy), files = new MessageFilesService(source,storage,policy);
    assert.ok(Object.values(policy.limits).every(n=>n<=20971520));
    const before = await source.query('SELECT (SELECT COUNT_BIG(*) FROM dbo.whatsapp_messages) AS messages,(SELECT COUNT_BIG(*) FROM dbo.whatsapp_message_media) AS media');
    const rows = await source.query("SELECT m.id AS messageId,m.conversationId,a.availability,a.storageKey,a.sizeBytes FROM dbo.whatsapp_messages m INNER JOIN dbo.whatsapp_message_media a ON a.messageId=m.id ORDER BY m.id");
    let ready=0,readable=0,unavailable=0,metadata=0;
    for(const row of rows) {
      const data=await files.metadata(row.conversationId,row.messageId); metadata++;
      assert.equal(Object.hasOwn(data,'storageKey'),false);
      if(row.availability!=='ready')continue;
      ready++;
      try { const file=await files.file(row.conversationId,row.messageId);assert.equal(file.size,row.sizeBytes);await file.handle.close();readable++; }
      catch(error) { assert.ok([404,409,503].includes(error.getStatus?.()));unavailable++; }
    }
    assert.deepEqual(await source.query('SELECT (SELECT COUNT_BIG(*) FROM dbo.whatsapp_messages) AS messages,(SELECT COUNT_BIG(*) FROM dbo.whatsapp_message_media) AS media'),before);
    t.diagnostic(JSON.stringify({historicalMetadata:metadata,ready,readable,unavailable,sqlWrites:0}));
  } finally { if(source?.isInitialized)await source.destroy(); }
});
