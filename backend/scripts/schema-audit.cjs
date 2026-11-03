// SELECT-only catalog inventory. No records, credentials or default values printed.
const fs=require('node:fs'),path=require('node:path'),sql=require('mssql'),{parse}=require('dotenv');
(async()=>{
 const pos=process.argv.indexOf('--config');if(pos<0||!process.argv[pos+1])throw Error('EXPLICIT_CONFIG_REQUIRED');
 const env=parse(fs.readFileSync(path.resolve(process.argv[pos+1])));
 const pool=await new sql.ConnectionPool({server:env.DB_HOST,port:Number(env.DB_PORT),user:env.DB_USERNAME,password:env.DB_PASSWORD,database:env.DB_DATABASE,options:{encrypt:env.DB_ENCRYPT==='true',trustServerCertificate:env.DB_TRUST_SERVER_CERTIFICATE==='true'},requestTimeout:30000}).connect();
 try{
  const query=async text=>{if(!text.startsWith('SELECT'))throw Error('SELECT_ONLY');return (await pool.request().query(text)).recordset;};
  const tables=await query('SELECT SCHEMA_NAME(t.schema_id) AS [schema],t.name AS [table],c.name AS [column],ty.name AS [type],c.max_length AS [length],c.precision,c.scale,c.is_nullable AS nullable,CASE WHEN dc.object_id IS NULL THEN 0 ELSE 1 END AS hasDefault FROM sys.tables t JOIN sys.columns c ON c.object_id=t.object_id JOIN sys.types ty ON ty.user_type_id=c.user_type_id LEFT JOIN sys.default_constraints dc ON dc.object_id=c.default_object_id WHERE t.is_ms_shipped=0 ORDER BY t.name,c.column_id');
  const constraints=await query("SELECT OBJECT_NAME(parent_object_id) AS [table],name,type_desc AS [type] FROM sys.objects WHERE type IN ('F','C','UQ','PK') ORDER BY parent_object_id,name");
  const indexes=await query('SELECT OBJECT_NAME(i.object_id) AS [table],i.name,i.is_unique,i.has_filter,c.name AS [column],ic.key_ordinal FROM sys.indexes i JOIN sys.index_columns ic ON ic.object_id=i.object_id AND ic.index_id=i.index_id JOIN sys.columns c ON c.object_id=ic.object_id AND c.column_id=ic.column_id JOIN sys.tables t ON t.object_id=i.object_id WHERE t.is_ms_shipped=0 ORDER BY t.name,i.name,ic.key_ordinal');
  console.log(JSON.stringify({tables,constraints,indexes},null,2));
 }finally{await pool.close();}
})().catch(()=>{console.error('SCHEMA_AUDIT_FAILED');process.exitCode=1;});
