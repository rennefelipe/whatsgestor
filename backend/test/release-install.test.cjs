const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {migrationDataSource}=require('../dist/database/data-source');
const {InitialSchema1793016000000}=require('../dist/database/migrations/1793016000000-InitialSchema');
const {SQL_V1,TABLES_V1,COLUMNS_V1}=require('../dist/database/migrations/schema-v1');
const {RecipientSelections1793390400000}=require('../dist/database/migrations/1793390400000-RecipientSelections');
const {RECIPIENT_SQL,RECIPIENT_TABLES,RECIPIENT_COLUMNS}=require('../dist/database/migrations/schema-recipient-selections');
const {args,target,plan}=require('../scripts/database.cjs');
const values={DB_HOST:'offline.invalid',DB_PORT:'1433',DB_USERNAME:'offline',DB_PASSWORD:'not-a-real-password',DB_DATABASE:'isolated_release_test',DB_ENCRYPT:'true',DB_TRUST_SERVER_CERTIFICATE:'false'};

test('all current runtime entities have migration columns including profiles and recipient selections offline',async()=>{
 const source=migrationDataSource(values);await source.buildMetadatas();
 assert.equal(source.migrations.length,3);assert.equal(RECIPIENT_TABLES.length,5);
 // Profile columns are intentionally managed by the raw SQL profile store,
 // outside the legacy User ORM metadata; users-schema.test covers that migration.
 const covered={...COLUMNS_V1,...RECIPIENT_COLUMNS};
 for(const meta of source.entityMetadatas)assert.deepEqual([...covered[meta.tableName]].sort(),meta.columns.map(c=>c.databaseName).sort(),meta.tableName);
 const {DataSource,Table,TableForeignKey}=require('typeorm');
 const {recipientSelectionEntities}=require('../dist/bulk-send/entities/recipient-selection.entity');
 const recipients=new DataSource({type:'mssql',schema:'dbo',entities:recipientSelectionEntities});await recipients.buildMetadatas();
 const runner=recipients.createQueryRunner(),sql=[],tables=recipients.entityMetadatas.map(meta=>({meta,table:Table.create(meta,recipients.driver)}));
 for(const {table}of tables){sql.push(runner.createTableSql(table,false).query);for(const index of table.indices)sql.push(runner.createIndexSql(table,index).query);}
 for(const {meta,table}of tables)for(const fk of meta.foreignKeys)sql.push(runner.createForeignKeySql(table,TableForeignKey.create(fk,recipients.driver)).query);
 assert.deepEqual(RECIPIENT_SQL,sql);assert.equal(source.isInitialized,false);assert.equal(recipients.isInitialized,false);
});

test('recipient migration refuses partial existing schema before any DDL and cannot destructively revert',async()=>{
 const migration=new RecipientSelections1793390400000(),written=[];
 await assert.rejects(()=>migration.up({hasTable:async()=>false,query:async sql=>written.push(sql)}),/REQUIRES_BASELINE/);
 for(const existing of RECIPIENT_TABLES)await assert.rejects(()=>migration.up({hasTable:async table=>table==='dbo.users'||table==='dbo.'+existing,query:async sql=>written.push(sql)}),/ALREADY_EXISTS/);
 assert.equal(written.length,0);
 await migration.up({hasTable:async table=>table==='dbo.users',query:async sql=>written.push(sql)});assert.deepEqual(written,RECIPIENT_SQL);
 assert.doesNotMatch(written.join('\n'),/\b(DROP|TRUNCATE|INSERT\s+INTO|DELETE\s+FROM|UPDATE\s+\[)\b/i);
 await assert.rejects(()=>migration.down(),/DESTRUCTIVE_ROLLBACK_DISABLED/);
});

test('frozen v1 baseline covers its original entities, raw connection table, constraints and safe seeds offline',async()=>{
 const source=migrationDataSource(values);assert.equal(source.isInitialized,false);
 for(const flag of ['synchronize','migrationsRun','dropSchema'])assert.equal(source.options[flag],false);
 await source.buildMetadatas();assert.equal(TABLES_V1.length,12);
 const baselineEntities=source.entityMetadatas.filter(meta=>Object.hasOwn(COLUMNS_V1,meta.tableName));
 assert.equal(baselineEntities.length,Object.keys(COLUMNS_V1).length);
 for(const meta of baselineEntities){assert.ok(TABLES_V1.includes(meta.tableName));assert.deepEqual(COLUMNS_V1[meta.tableName],meta.columns.map(c=>c.databaseName));}
 assert.equal(SQL_V1.filter(s=>s.startsWith('CREATE TABLE')).length,12);
 assert.ok(SQL_V1.some(s=>s.includes('UQ_whatsapp_messages_conversation_message_fromMe')));
 assert.ok(SQL_V1.some(s=>s.includes('FK_v1_conversation_connection')));
 assert.equal(SQL_V1.filter(s=>s.includes('CK_whatsapp_message_media_')).length,4);
 assert.equal(SQL_V1.filter(s=>s.startsWith('INSERT')).length,1);
 assert.doesNotMatch(SQL_V1.join('\n'),/\b(DROP|TRUNCATE|DELETE)\s+(TABLE|DATABASE|FROM)\b/i);
 assert.throws(()=>migrationDataSource({...values,DB_PORT:'NaN'}),/PORT_INVALID/);
 assert.throws(()=>migrationDataSource({...values,DB_ENCRYPT:'yes'}),/TLS_CONFIG_REQUIRED/);
});

test('baseline refuses existing tables before writing and never performs destructive down',async()=>{
 const migration=new InitialSchema1793016000000(),written=[];
 await assert.rejects(()=>migration.up({hasTable:async()=>true,query:async sql=>written.push(sql)}),/EMPTY_DATABASE/);assert.equal(written.length,0);
 await migration.up({hasTable:async()=>false,query:async sql=>written.push(sql)});assert.deepEqual(written,SQL_V1);
 await assert.rejects(()=>migration.down(),/DESTRUCTIVE_ROLLBACK_DISABLED/);
});

test('read-only plan tracks reapplication and refuses legacy/unknown schemas',async()=>{
 const source={migrations:[new InitialSchema1793016000000()]};let queries=[];
 const runner=(tables,history=[])=>({query:async sql=>{queries.push(sql);assert.match(sql,/^SELECT /);return sql.includes('sys.tables')?tables.map(name=>({name})):history.map(name=>({name}));}});
 assert.equal((await plan(source,runner([]))).pending.length,1);
 assert.equal((await plan(source,runner(['whatsgestor_migrations','users'],['InitialSchema1793016000000']))).pending.length,0);
 await assert.rejects(()=>plan(source,runner(['users'])),/UNVERSIONED_EXISTING_SCHEMA/);
 await assert.rejects(()=>plan(source,runner(['whatsgestor_migrations'],['Unknown'])),/UNKNOWN_MIGRATION_HISTORY/);
 assert.ok(queries.length>0);
});

test('maintenance CLI requires explicit independent target and exact confirmation',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wg-release-config-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const file=path.join(dir,'isolated.env');fs.writeFileSync(file,Object.entries(values).map(([k,v])=>`${k}=${v}`).join('\n'));
 assert.throws(()=>args(['migrate','--config','--apply']),/ARGUMENT_VALUE_REQUIRED/);
 assert.throws(()=>args(['migrate','--force']),/UNKNOWN_ARGUMENT/);
 assert.throws(()=>target({action:'migrate',config:path.resolve('.env'),database:'any'}),/LIVE_ENV/);
 assert.throws(()=>target({action:'plan',config:file,database:'wrong'}),/CONFIRMATION_MISMATCH/);
 assert.equal(target({action:'plan',config:file,database:values.DB_DATABASE}).DB_DATABASE,values.DB_DATABASE);
 fs.writeFileSync(file,'DB_DATABASE=master');assert.throws(()=>target({action:'plan',config:file,database:'master'}),/SYSTEM_DATABASE/);
});

test('bootstrap inserts one hashed administrator only into an empty migrated database',async t=>{
 const vm=require('node:vm'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'wg-bootstrap-config-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const file=path.join(dir,'isolated.env');fs.writeFileSync(file,Object.entries(values).map(([k,v])=>`${k}=${v}`).join('\n'));
 let count=0,commits=0,rollbacks=0,inserted,hashed;
 const runner={isTransactionActive:false,connect:async()=>{},release:async()=>{},
  startTransaction:async()=>{runner.isTransactionActive=true;},commitTransaction:async()=>{commits++;runner.isTransactionActive=false;},rollbackTransaction:async()=>{rollbacks++;runner.isTransactionActive=false;},
  query:async(sql,params)=>{
   if(sql.includes('DB_NAME()'))return [{name:values.DB_DATABASE}];
   if(sql.includes('sys.tables'))return [{name:'whatsgestor_migrations'},{name:'users'}];
   if(sql.includes('SELECT [name]'))return [{name:'InitialSchema1793016000000'}];
   if(sql.includes('COUNT_BIG'))return [{count}];
   if(sql.startsWith('INSERT')){assert.match(sql,/\[fullName\],\[role\]/);assert.match(sql,/N'administrator'/);assert.ok(!sql.includes('exclusive-test-password'));inserted=params;count++;}return [];
  }};
 const source={isInitialized:false,migrations:[new InitialSchema1793016000000()],initialize:async()=>{source.isInitialized=true;},createQueryRunner:()=>runner,destroy:async()=>{source.isInitialized=false;}};
 const module={exports:{}},localRequire=name=>name==='../dist/database/data-source'?{migrationDataSource:()=>source}:name==='../dist/users/password-hash'?{hashPassword:async value=>{hashed=value;return 'TEST_HASH_ONLY';}}:require(name);
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../scripts/database.cjs'),'utf8'),{module,exports:module.exports,require:localRequire,Buffer,__dirname:path.join(__dirname,'../scripts'),process:{env:{WG_INITIAL_ADMIN_PASSWORD:'exclusive-test-password'}},console:{log:()=>{}}});
 const argv=['bootstrap','--config',file,'--database',values.DB_DATABASE,'--username','test-admin','--apply'];
 await module.exports.main(argv);assert.equal(commits,1);assert.equal(hashed,'exclusive-test-password');assert.deepEqual(Array.from(inserted),['test-admin','TEST_HASH_ONLY']);
 await assert.rejects(()=>module.exports.main(argv),/BOOTSTRAP_ONLY_FOR_EMPTY_USERS/);assert.equal(count,1);assert.equal(rollbacks,1);
 await assert.rejects(()=>module.exports.main(argv.filter(v=>v!=='--apply')),/APPLY_REQUIRED/);
});
