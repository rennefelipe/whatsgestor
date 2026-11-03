// Explicit maintenance CLI. Never loads backend/.env as the target configuration.
const fs=require('node:fs'),path=require('node:path');
const {parse}=require('dotenv');
const {migrationDataSource}=require('../dist/database/data-source');
const {MigrationExecutor}=require('typeorm');
function args(argv){const result={action:argv[0]};for(let i=1;i<argv.length;i++){const key=argv[i];if(!['--config','--database','--username','--apply','--maintenance-approved'].includes(key))throw Error('UNKNOWN_ARGUMENT');if(key==='--apply'||key==='--maintenance-approved')result[key.slice(2)]=true;else{const value=argv[++i];if(!value||value.startsWith('--'))throw Error('ARGUMENT_VALUE_REQUIRED');result[key.slice(2)]=value;}}return result;}
function target(options){
 if(!['plan','migrate','bootstrap'].includes(options.action)||!options.config||!options.database)throw Error('EXPLICIT_CONFIG_AND_DATABASE_REQUIRED');
 const file=path.resolve(options.config),live=path.resolve(__dirname,'../.env');if(file===live)throw Error('LIVE_ENV_CANNOT_BE_TARGET_FILE');
 const values=parse(fs.readFileSync(file));if(values.DB_DATABASE!==options.database)throw Error('DATABASE_CONFIRMATION_MISMATCH');
 if(['master','model','msdb','tempdb'].includes(values.DB_DATABASE.toLowerCase()))throw Error('SYSTEM_DATABASE_FORBIDDEN');
 if(fs.existsSync(live)){
  const current=parse(fs.readFileSync(live));
  const same=['DB_HOST','DB_DATABASE'].every(k=>String(current[k]).toLowerCase()===String(values[k]).toLowerCase())&&String(current.DB_PORT)===String(values.DB_PORT);
  if(same&&!options['maintenance-approved'])throw Error('CONFIGURED_DATABASE_REQUIRES_MAINTENANCE_APPROVAL');
 }
 return values;
}
async function plan(source,runner){
 const tables=await runner.query('SELECT name FROM sys.tables WHERE is_ms_shipped=0');
 const hasHistory=tables.some(t=>t.name==='whatsgestor_migrations');
 const applied=hasHistory?await runner.query('SELECT [name] FROM [dbo].[whatsgestor_migrations] ORDER BY [id]'):[];
 const known=source.migrations.map(m=>m.name??m.constructor.name);
 if(applied.some(row=>!known.includes(row.name)))throw Error('UNKNOWN_MIGRATION_HISTORY_REQUIRES_REVIEW');
 const pending=known.filter(name=>!applied.some(row=>row.name===name));
 if(pending.includes('InitialSchema1793016000000')&&tables.some(t=>t.name!=='whatsgestor_migrations'))throw Error('UNVERSIONED_EXISTING_SCHEMA_REQUIRES_REVIEW');
 return {tableCount:tables.length,applied:applied.length,pending};
}
async function main(argv=process.argv.slice(2)){
 const options=args(argv),values=target(options);
 if(options.action!=='plan'&&!options.apply)throw Error('APPLY_REQUIRED');
 const source=migrationDataSource(values);let runner;
 try{
  await source.initialize();runner=source.createQueryRunner();await runner.connect();
  const actual=await runner.query('SELECT DB_NAME() AS [name]');if(actual[0]?.name!==options.database)throw Error('CONNECTED_DATABASE_MISMATCH');
  if(options.action==='plan'){console.log(JSON.stringify({mode:'read-only',...await plan(source,runner)}));return;}
  await runner.startTransaction('SERIALIZABLE');
  try{
   await runner.query("DECLARE @r int; EXEC @r=sys.sp_getapplock @Resource=N'WhatsGestor.release',@LockMode=N'Exclusive',@LockOwner=N'Transaction',@LockTimeout=0; IF @r<0 THROW 51000,N'MAINTENANCE_ALREADY_RUNNING',1;");
   const status=await plan(source,runner);
   if(options.action==='migrate'){
    const executor=new MigrationExecutor(source,runner);executor.transaction='all';const applied=await executor.executePendingMigrations();
    await runner.commitTransaction();console.log(JSON.stringify({applied:applied.length}));
   }else{
    if(status.pending.length)throw Error('BOOTSTRAP_REQUIRES_MIGRATIONS');
    const username=options.username?.trim(),password=process.env.WG_INITIAL_ADMIN_PASSWORD;
    if(!username||username.length>100||!password||password.length<12||Buffer.byteLength(password,'utf8')>72)throw Error('BOOTSTRAP_REQUIRES_USERNAME_AND_STRONG_PASSWORD');
    const users=await runner.query('SELECT COUNT_BIG(*) AS [count] FROM [dbo].[users] WITH (TABLOCKX,HOLDLOCK)');
    if(Number(users[0].count)!==0)throw Error('BOOTSTRAP_ONLY_FOR_EMPTY_USERS');
    const {hashPassword}=require('../dist/users/password-hash');const hash=await hashPassword(password);
    await runner.query("INSERT INTO [dbo].[users] ([username],[passwordHash],[fullName],[role],[isAdmin],[canDelete],[isActive]) VALUES (@0,@1,@0,N'administrator',1,1,1)",[username,hash]);
    await runner.commitTransaction();console.log(JSON.stringify({initialAdminCreated:true}));
   }
  }catch(error){if(runner.isTransactionActive)await runner.rollbackTransaction();throw error;}
 }finally{if(runner)await runner.release();if(source.isInitialized)await source.destroy();}
}
module.exports={args,target,plan,main};
if(require.main===module)void main().catch(error=>{const safe=typeof error.message==='string'&&/^[A-Z][A-Z0-9_]+$/.test(error.message)?error.message:'DATABASE_TOOL_FAILED';console.error(safe);process.exitCode=1;});
