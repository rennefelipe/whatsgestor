// Allowlisted source export. Never stages Git files or copies live operational data.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const ROOT=path.resolve(__dirname,'..');
const TREES=['backend/src','backend/test','backend/scripts','frontend/app','frontend/components','frontend/hooks','frontend/lib','frontend/services','frontend/types','frontend/public','frontend/tests','docs','deploy','scripts'];
const FILES=['README.md','.gitignore','backend/package.json','backend/package-lock.json','backend/tsconfig.json','backend/.env.example','frontend/package.json','frontend/package-lock.json','frontend/tsconfig.json','frontend/next.config.ts','frontend/eslint.config.mjs','frontend/.editorconfig','frontend/.gitignore','frontend/.env.example','frontend/README.md','frontend/AGENTS.md'];
function excluded(name,directory=false){return /^(node_modules|\.git|\.next|dist|coverage|logs|temp|tmp|storage|private|media|uploads|whatsapp-sessions|\.whatsgestor|auth_info|auth_info_baileys|baileys_auth_info)$/i.test(name)||(directory&&/^backup-/i.test(name))||/\.bak|\.(enc|part|key|pfx|p12|pem|log|tsbuildinfo|mdf|ldf|ndf|trn|db|db-wal|db-shm|dmp|bkp|backup|sqlite|sqlite3|dump|xlsx|xls|csv)$|\.session(?:\.json)?$|\.socket\.lock$/i.test(name)||/^(master\.key|creds\.json)$/i.test(name)||(name.startsWith('.env')&&!/^\.env(?:\..+)?\.example$/.test(name));}
// Redact the phone supplied as an example in the original brief, only in the
// exported sample/help and fixtures. Never edit the operational working copy.
const SAMPLE_FILES=new Set(['frontend/services/excel.ts','frontend/tests/excel.test.mjs','frontend/tests/browser-contacts.mjs','backend/test/registration-exchange.test.cjs']);
function sampleRedactions(){
 const file=path.join(ROOT,'artifacts/github-preparation/sample-redactions.private.json');
 if(!fs.existsSync(file))return [];
 const pairs=JSON.parse(fs.readFileSync(file,'utf8'));
 if(!Array.isArray(pairs)||pairs.some(pair=>!Array.isArray(pair)||pair.length!==2||pair.some(value=>typeof value!=='string'||!value)))throw Error('INVALID_PRIVATE_SAMPLE_REDACTIONS');
 return pairs;
}
function publicationBytes(name,bytes,redactions=sampleRedactions()){
 if(!SAMPLE_FILES.has(name))return bytes;
 let text=bytes.toString('utf8');for(const [original,replacement]of redactions)text=text.replaceAll(original,replacement);
 return Buffer.from(text);
}
function candidates(root=ROOT){
 const result=new Set();
 function walk(relative){const absolute=path.join(root,relative);if(!fs.existsSync(absolute))return;const info=fs.lstatSync(absolute);if(info.isSymbolicLink())throw Error('SYMLINK_IN_SOURCE_EXPORT');if(excluded(path.basename(relative),info.isDirectory()))return;if(info.isDirectory())for(const entry of fs.readdirSync(absolute))walk(path.join(relative,entry));else result.add(relative.replaceAll('\\','/'));}
 for(const file of FILES)walk(file);for(const tree of TREES)walk(tree);return [...result].sort();
}
function main(){
 const argv=process.argv.slice(2);if(argv.length!==2||argv[0]!=='--destination')throw Error('EXPLICIT_DESTINATION_REQUIRED');
 const destination=path.resolve(argv[1]);const relative=path.relative(ROOT,destination);
 if(!relative||(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative)))throw Error('DESTINATION_MUST_BE_OUTSIDE_REPOSITORY');
 if(fs.existsSync(destination)&&fs.readdirSync(destination).length)throw Error('DESTINATION_MUST_BE_EMPTY');
 const manifest=[];for(const name of candidates()){
  const source=path.join(ROOT,name),target=path.join(destination,name),original=fs.readFileSync(source),bytes=publicationBytes(name,original);
  fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes,{flag:'wx'});
  const sha256=crypto.createHash('sha256').update(bytes).digest('hex');
  if(crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex')!==sha256)throw Error('EXPORT_HASH_MISMATCH');
  manifest.push({path:name,bytes:bytes.length,sha256,...(!bytes.equals(original)?{sampleRedacted:true}:{})});
 }
 fs.writeFileSync(path.join(destination,'RELEASE-MANIFEST.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({version:'1.0.0',files:manifest.length,hashesVerified:true,publicationPerformed:false}));
}
module.exports={candidates,excluded,publicationBytes};if(require.main===module)main();
