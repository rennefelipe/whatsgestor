require('reflect-metadata');
const {test}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {Global,Module,Logger}=require('@nestjs/common'),{NestFactory,ModulesContainer}=require('@nestjs/core');
const {ConfigModule,ConfigService}=require('@nestjs/config'),{JwtService}=require('@nestjs/jwt');
const {DataSource}=require('typeorm');
const {configureApplication}=require('../dist/application'),{createDatabaseOptions}=require('../dist/config/database');
const {AuthModule}=require('../dist/auth/auth.module'),{BulkSendModule}=require('../dist/bulk-send/bulk-send.module');
const {ContactsService}=require('../dist/contacts/contacts.service');
const {RecipientSelectionsService}=require('../dist/bulk-send/recipient-selections.service');
const {SqlRecipientSelectionStore}=require('../dist/bulk-send/recipient-selection-store');
const {recipientSelectionEntities,RecipientSelection:Header,RecipientSelectionItem:Item,RecipientSelectionRevision:Revision}=require('../dist/bulk-send/entities/recipient-selection.entity');
const {SelectionDatabaseFixture}=require('./helpers/selection-database.fixture.cjs');
const {registrationsFixture,Contact,ContactType,Preference}=require('./helpers/registrations-fixture.cjs');
Logger.overrideLogger(false);
const base='/bulk-send/recipient-selections';

async function fixture(t){
 const contacts=await registrationsFixture(t),selectionDatabase=new SelectionDatabaseFixture(),selectionSource=selectionDatabase.asDataSource();
 const options=createDatabaseOptions(new ConfigService({DB_HOST:'isolated.invalid',DB_PORT:1433,DB_USERNAME:'fixture',DB_PASSWORD:'unused-fixture',DB_DATABASE:'isolated',DB_ENCRYPT:true,DB_TRUST_SERVER_CERTIFICATE:false}));
 const source=new DataSource(options);await source.buildMetadatas();assert.equal(source.isInitialized,false);
 const links=[],linkQueries=[];let storageFault=null;
 const linkRepository={createQueryBuilder(){
  // No initialize(), driver pool or network IO.
  const builder={};let cursor;
  for(const method of ['innerJoin','select','addSelect','orderBy','limit'])builder[method]=()=>builder;
  builder.where=(_sql,params)=>{cursor=params.identityCursor;return builder;};
  builder.getRawMany=async()=>{linkQueries.push(true);return links.filter(row=>!cursor||row.id>cursor).slice(0,500);};return builder;
 }};
 source.getRepository=entity=>{
  if(recipientSelectionEntities.includes(entity)){if(storageFault)throw storageFault;return selectionSource.getRepository(entity);}
  if(entity.name==='WhatsappConversation')return linkRepository;
  assert.ok(contacts.repos.has(entity),'only contact/auth and selection repositories may be accessed');return contacts.repos.get(entity);
 };
 source.query=async(sql)=>{assert.match(sql,/profileColumnCount/);return [{profileColumnCount:0}];};
 source.transaction=selectionSource.transaction;source.manager.getRepository=source.getRepository;
 class FakeDatabaseModule{}Global()(FakeDatabaseModule);Module({providers:[{provide:DataSource,useValue:source}],exports:[DataSource]})(FakeDatabaseModule);
 class TestModule{}Module({imports:[ConfigModule.forRoot({isGlobal:true,ignoreEnvFile:true,ignoreEnvVars:true,skipProcessEnv:true,load:[()=>({JWT_SECRET:'recipient-test-only-jwt-secret-at-least-32-characters',JWT_EXPIRES_IN:3600,CORS_ORIGINS:['http://localhost:3000']})]}),FakeDatabaseModule,AuthModule,BulkSendModule]})(TestModule);
 const app=await NestFactory.create(TestModule,{logger:false,forceCloseConnections:true});t.after(()=>app.close());configureApplication(app);await app.listen(0,'127.0.0.1');
 const origin=await app.getUrl(),jwt=app.get(JwtService),token=await jwt.signAsync({sub:contacts.admin.id,userRevision:contacts.admin.updatedAt.toISOString()}),otherToken=await jwt.signAsync({sub:contacts.regular.id,userRevision:contacts.regular.updatedAt.toISOString()});
 const call=async(path,{method='GET',body,bearer=token}={})=>{const response=await fetch(origin+path,{method,headers:{...(bearer?{Authorization:'Bearer '+bearer}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});const text=await response.text();return {status:response.status,body:text?JSON.parse(text):null};};
 const create=async(filters={},requestId=randomUUID())=>call(base,{method:'POST',body:{filters,requestId}});
 const mutate=async(selection,action,extra={},requestId=randomUUID())=>call(base+'/'+selection.id,{method:'PATCH',body:{version:selection.version,action,...extra,requestId}});
 return {...contacts,app,source,selectionDatabase,selectionSource,call,create,mutate,otherToken,links,linkQueries,
  setStorageFault:value=>{storageFault=value;},snapshot:()=>JSON.stringify([...contacts.state]),
  count:async entity=>(await selectionSource.getRepository(entity).find()).length};
}

test('registered module exposes latest with JWT and SQL metadata without schema sync or WhatsApp modules',async t=>{
 const f=await fixture(t);assert.equal((await f.call(base+'/latest',{bearer:null})).status,401);
 const latest=await f.call(base+'/latest');assert.equal(latest.status,200);assert.equal(latest.body,null);
 for(const flag of ['synchronize','migrationsRun','dropSchema'])assert.equal(f.source.options[flag],false);
 assert.equal(f.source.entityMetadatas.filter(meta=>recipientSelectionEntities.includes(meta.target)).length,5);
 const providers=[...f.app.get(ModulesContainer).values()].flatMap(module=>[...module.providers.keys()].map(token=>token?.name??String(token)));
 for(const name of ['OutboundRouter','BaileysOutboundAdapter','MessagesService','ConnectionManager'])assert.equal(providers.includes(name),false);
 assert.equal(f.operations.length,0);assert.equal(await f.count(Header),0);
});

test('real contact filters and normalization are shared; duplicate sources become one selectable context',async t=>{
 const f=await fixture(t);f.seed(Contact,{...f.contact,id:randomUUID(),phone:'+55 (11) 98765-4321',storeName:'  CAFE\u0301   CENTRAL '});
 f.seed(Contact,{...f.contact,id:randomUUID(),contactName:'Outro cadastro',phone:'invalid',isActive:false});
 const before=f.snapshot(),result=await f.create({groupId:f.group.id,shoppingId:f.shopping.id,contactTypeId:f.contactType.id,storeName:'Café Central',contactName:'fictício',phone:'+5511987654321'});
 assert.equal(result.status,201);assert.equal(result.body.total,1);assert.equal(result.body.items[0].sourceCount,2);
 assert.equal(result.body.summary.duplicatesIdentified,1);assert.equal(result.body.readyForSending,false);assert.equal(result.body.persistence,'sql');
 assert.equal(f.snapshot(),before);assert.ok(f.queries.every(q=>/^SELECT /i.test(q.sql)));assert.equal(f.operations.length,0);
 const none=await f.mutate(result.body,'filter',{filters:{groupId:randomUUID()}});assert.equal(none.status,200);assert.equal(none.body.total,0);
});

test('individual/all selection, pagination and repeated selection preserve unique keys and published history',async t=>{
 const f=await fixture(t);for(let n=0;n<28;n++)f.seed(Contact,{...f.contact,id:randomUUID(),contactName:'Pessoa '+String(n).padStart(2,'0'),phone:String(5511987600000+n),storeName:null});
 const original=f.snapshot();let result=await f.create();assert.equal(result.status,201);let selection=result.body;const id=selection.id,key=selection.items[0].key;
 result=await f.mutate(selection,'add',{key});assert.equal(result.status,200);selection=result.body;assert.equal(selection.summary.selectedRecipients,1);
 result=await f.mutate(selection,'add',{key});assert.equal(result.status,200);selection=result.body;assert.equal(selection.summary.selectedRecipients,1);
 result=await f.mutate(selection,'all');assert.equal(result.status,200);selection=result.body;assert.equal(selection.summary.selectedEligible,29);
 const page=await f.call(base+'/'+id+'?view=selected&page=2&pageSize=25');assert.equal(page.status,200);assert.equal(page.body.items.length,4);assert.equal(new Set(page.body.items.map(row=>row.key)).size,4);
 result=await f.mutate(selection,'filter',{filters:{withoutStore:true}});selection=result.body;assert.equal(selection.total,28);assert.equal(selection.summary.selectedRecipients,29);
 const selected=await f.call(base+'/'+id+'?view=selected&pageSize=100');assert.equal(new Set(selected.body.items.map(row=>row.key)).size,29);
 result=await f.mutate(selection,'remove',{key});selection=result.body;assert.equal(selection.summary.selectedRecipients,28);
 result=await f.mutate(selection,'clear');assert.equal(result.body.summary.selectedRecipients,0);
 assert.ok(await f.count(Revision)>1);assert.equal(f.snapshot(),original);assert.equal(f.operations.length,0);
});

test('restriction and inactive/invalid contacts cannot be selected; unavailable preference registry fails closed',async t=>{
 const f=await fixture(t);f.seed(Contact,{...f.contact,id:randomUUID(),phone:'invalid'});f.seed(Contact,{...f.contact,id:randomUUID(),phone:'11987654322',isActive:false});
 f.seed(Preference,{normalizedPhone:'+5511987654321',whatsappIdentity:null,connectionId:null,evidenceConversationId:null,shoppingId:null,isActive:true});
 let result=await f.create();assert.equal(result.status,201);assert.equal(result.body.summary.eligibleFound,0);
 assert.equal((await f.mutate(result.body,'add',{key:result.body.items[0].key})).status,400);
 const latest=await f.call(base+'/latest');assert.equal(latest.status,200);result=await f.mutate(latest.body,'all');assert.equal(result.body.summary.selectedRecipients,0);
 // snapshot uses find(), so inject the read failure rather than a write error.
 const repository=f.repos.get(Preference),read=repository.find;repository.find=async()=>{throw Error('PRIVATE_PREFERENCE_FAILURE');};
 const failed=await f.call(base+'/latest');assert.equal(failed.status,503);assert.doesNotMatch(JSON.stringify(failed.body),/PRIVATE_/);repository.find=read;
});

test('SQL store survives service recreation, enforces ownership/version and idempotent concurrent requests',async t=>{
 const f=await fixture(t),requestId=randomUUID();let result=await f.create({},requestId);assert.equal(result.status,201);let selection=result.body;
 const retry=await f.create({},requestId);assert.equal(retry.body.id,selection.id);assert.equal(await f.count(Header),1);assert.equal(await f.count(Revision),1);
 const other=await f.call(base+'/'+selection.id,{bearer:f.otherToken});assert.equal(other.status,404);assert.equal((await f.call(base+'/latest',{bearer:f.otherToken})).body,null);
 const old=selection;result=await f.mutate(selection,'all');selection=result.body;assert.equal((await f.mutate(old,'clear')).status,409);
 const service=f.app.get(RecipientSelectionsService),recreated=new RecipientSelectionsService(service.catalog,new SqlRecipientSelectionStore(f.source));
 const restored=await recreated.latest(f.admin.id);assert.equal(restored.id,selection.id);assert.equal(restored.summary.selectedEligible,1);
 const id=randomUUID(),body={version:selection.version,action:'clear',requestId:id};
 const responses=await Promise.all([f.call(base+'/'+selection.id,{method:'PATCH',body}),f.call(base+'/'+selection.id,{method:'PATCH',body})]);
 assert.ok(responses.every(row=>row.status===200));assert.equal((await f.call(base+'/latest')).body.version,selection.version+1);
 const operation=await f.call(base+'/operations/'+id);assert.equal(operation.status,200);assert.equal(operation.body.status,'completed');assert.equal(operation.body.requestId,id);
 assert.equal((await f.call(base+'/operations/'+id,{bearer:f.otherToken})).status,404);
});

test('interrupted revision keeps the previous publication; explicit recovery completes without duplicate recipients',async t=>{
 const f=await fixture(t),first=await f.create(),selection=first.body,id=randomUUID();
 f.selectionDatabase.beforeInsert=entity=>{if(entity===Item)throw Error('PRIVATE_STORAGE_FAILURE');};
 const failed=await f.mutate(selection,'all',{},id);assert.equal(failed.status,503);assert.doesNotMatch(JSON.stringify(failed.body),/PRIVATE_/);
 let latest=await f.call(base+'/latest');assert.equal(latest.body.version,selection.version);assert.equal(latest.body.summary.selectedRecipients,0);
 const operation=await f.call(base+'/operations/'+id);assert.equal(operation.body.status,'failed');assert.equal(operation.body.recoverable,true);assert.doesNotMatch(JSON.stringify(operation.body),/PRIVATE_/);
 f.selectionDatabase.beforeInsert=undefined;
 const recovered=await f.call(base+'/operations/'+operation.body.id+'/recover',{method:'POST'});assert.equal(recovered.status,201);assert.equal(recovered.body.summary.selectedRecipients,1);
 const repeated=await f.call(base+'/operations/'+operation.body.id+'/recover',{method:'POST'});assert.equal(repeated.body.version,recovered.body.version);
 latest=await f.call(base+'/latest');assert.equal(latest.body.summary.selectedEligible,1);assert.equal(f.operations.length,0);
});

test('schema errors, connectivity errors and invalid DTOs are distinct and do not change data',async t=>{
 const f=await fixture(t),before=f.snapshot();
 f.setStorageFault({driverError:{number:208,message:'PRIVATE_SCHEMA_DETAIL'}});
 let result=await f.call(base+'/latest');assert.equal(result.status,503);assert.equal(result.body.code,'RECIPIENT_SELECTION_SCHEMA_MISSING');assert.doesNotMatch(JSON.stringify(result.body),/PRIVATE_/);
 f.setStorageFault({driverError:{number:53,message:'PRIVATE_HOST_DETAIL'}});
 result=await f.call(base+'/latest');assert.equal(result.body.code,'RECIPIENT_SELECTION_STORAGE_UNAVAILABLE');assert.doesNotMatch(result.body.message,/migration/i);f.setStorageFault(null);
 for(const body of [{},{filters:[]},{filters:{unexpected:true}},{filters:{groupId:'invalid'}}])assert.equal((await f.call(base,{method:'POST',body})).status,400);
 const selection=(await f.create()).body;
 assert.equal((await f.mutate(selection,'send')).status,400);assert.equal((await f.call(base+'/'+selection.id+'?page=0')).status,400);
 assert.equal((await f.mutate(selection,'add',{key:'invalid'})).status,400);assert.equal(f.snapshot(),before);assert.equal(f.operations.length,0);
});
