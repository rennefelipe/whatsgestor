const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {resolve}=require('node:path');
const {parse}=require('dotenv');
const {ConfigService}=require('@nestjs/config');
const {createDatabaseOptions,initializeDataSource}=require('../dist/config/database');
const {validateEnvironment}=require('../dist/config/environment');
const {ConnectionRegistry}=require('../dist/whatsapp-integration/connection-registry');
test('connection registry matches existing SQL schema using SELECT only and leaves row counts unchanged',async()=>{
  let source;
  try{
    const values={...parse(readFileSync(resolve(__dirname,'../.env'))),...process.env};
    source=await initializeDataSource({...createDatabaseOptions(new ConfigService(validateEnvironment(values))),requestTimeout:30000});
    assert.equal(source.options.synchronize,false);assert.equal(source.options.migrationsRun,false);assert.equal(source.options.dropSchema,false);
    const create=source.createQueryRunner.bind(source);
    source.createQueryRunner=(...args)=>{const runner=create(...args),query=runner.query.bind(runner);
      runner.query=(sql,...params)=>{assert.match(sql.trim(),/^SELECT\b/i,'SELECT only');return query(sql,...params);};return runner;};
    const counts=()=>source.query('SELECT (SELECT COUNT_BIG(*) FROM dbo.whatsapp_connections) AS connections,(SELECT COUNT_BIG(*) FROM dbo.whatsapp_conversations) AS conversations,(SELECT COUNT_BIG(*) FROM dbo.whatsapp_messages) AS messages,(SELECT COUNT_BIG(*) FROM dbo.whatsapp_message_media) AS media');
    const before=await counts();
    const columns=await source.query("SELECT c.name,t.name AS type,c.max_length AS maxLength,c.is_nullable AS nullable FROM sys.columns c JOIN sys.types t ON c.user_type_id=t.user_type_id WHERE c.object_id=OBJECT_ID('dbo.whatsapp_connections')");
    for(const name of ['id','name','phoneNumber','status','isActive','createdAt','updatedAt','lastConnectedAt','lastDisconnectedAt'])assert.ok(columns.some(c=>c.name===name));
    assert.equal(columns.find(c=>c.name==='name').maxLength,300);assert.equal(columns.find(c=>c.name==='status').maxLength,60);
    const registry=new ConnectionRegistry(source),rows=await registry.list();assert.equal(rows.length,Number(before[0].connections));
    for(const row of rows)assert.equal((await registry.find(row.id)).id,row.id);
    assert.deepEqual(await counts(),before);
    assert.equal(source.entityMetadatas.length,11);
  }finally{if(source?.isInitialized)await source.destroy();}
});
