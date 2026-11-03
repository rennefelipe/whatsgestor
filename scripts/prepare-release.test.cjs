const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {candidates,excluded,publicationBytes}=require('./prepare-release.cjs');
test('export includes installation sources/examples and excludes operational data',()=>{
 const files=candidates();for(const file of ['backend/.env.example','frontend/.env.example','backend/src/database/migrations/schema-v1.ts','backend/scripts/sql/create-clean-database.sql','backend/scripts/install-new.cjs','backend/scripts/verify-install.cjs','scripts/install-windows.ps1','scripts/start-windows.ps1','README.md','docs/BACKUP-RESTAURACAO.md'])assert.ok(files.includes(file),file);
 assert.equal(excluded('backup-old',true),true);assert.equal(excluded('BACKUP-RESTAURACAO.md'),false);
 for(const file of files){assert.ok(!file.startsWith('artifacts/')&&!file.startsWith('backend-backup/'));assert.equal(excluded(path.basename(file)),false);}
 for(const name of ['.env','.env.local','.env.install','master.key','secret.enc','session.part','creds.json','identity.session.json','certificate.pfx','database.mdf','database.ldf','database.ndf','database.trn','database.db','database.db-wal','database.db-shm','database.dmp','auth_info','auth_info_baileys','baileys_auth_info','backup.bkp','old.bak-audio','current.socket.lock'])assert.equal(excluded(name),true,name);
});
test('publication replaces the brief phone only in approved example files',()=>{
 const original=Buffer.from('SAMPLE_PRIVATE_PHONE'),pairs=[['SAMPLE_PRIVATE_PHONE','11999991234']];
 assert.equal(publicationBytes('frontend/services/excel.ts',original,pairs).toString(),'11999991234');
 assert.equal(publicationBytes('backend/src/messages/example.ts',original,pairs),original);
});
test('export walker never follows a linked source tree',t=>{
 const work=fs.mkdtempSync(path.join(os.tmpdir(),'wg-release-export-'));t.after(()=>fs.rmSync(work,{recursive:true,force:true}));
 const outside=path.join(work,'outside'),root=path.join(work,'root');fs.mkdirSync(outside);fs.mkdirSync(path.join(root,'backend'),{recursive:true});
 fs.symlinkSync(outside,path.join(root,'backend/src'),'junction');assert.throws(()=>candidates(root),/SYMLINK_IN_SOURCE_EXPORT/);
});
