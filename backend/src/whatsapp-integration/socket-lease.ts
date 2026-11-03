import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { open, readFile, unlink } from 'node:fs/promises';
import { codedError } from './contracts';

// A stable guard file is opened with kernel-enforced exclusive sharing. All
// inspection, reclamation and deletion happens in that same owner process.
// Never delete the guard file: replacing it would split the lock identity.
const windowsLease = String.raw`
$ErrorActionPreference='Stop'
$guard=$null
try {
  # PID-only legacy records are meaningful only on a local machine. Refuse
  # network/mapped volumes rather than guessing the owner of a shared session.
  $volume=[IO.DriveInfo]::new([IO.Path]::GetPathRoot($env:WG_LEASE_PATH))
  if($volume.DriveType -ne [IO.DriveType]::Fixed){throw 'local fixed volume required'}
  if([IO.File]::Exists($env:WG_LEASE_GUARD)) {
    $guardInfo=Get-Item -LiteralPath $env:WG_LEASE_GUARD -Force
    if($guardInfo.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'invalid guard'}
  }
  try { $guard=[IO.File]::Open($env:WG_LEASE_GUARD,[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None) }
  catch { if(($_.Exception.GetBaseException().HResult -band 65535) -in @(32,33)){[Console]::Out.WriteLine('SOCKET_LEASE_EXISTS')}else{[Console]::Out.WriteLine('SOCKET_LEASE_UNVERIFIED')}; exit 1 }
  if([IO.File]::Exists($env:WG_LEASE_PATH)) {
    try {
      $info=Get-Item -LiteralPath $env:WG_LEASE_PATH -Force
      if(($info.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $info.Length -gt 4096){throw 'invalid'}
      $previous=[IO.File]::ReadAllText($env:WG_LEASE_PATH) | ConvertFrom-Json
      if($previous.pid -isnot [int] -and $previous.pid -isnot [long]){throw 'invalid'}
      if($previous.pid -le 0 -or ($previous.host -and $previous.host -ne $env:WG_LEASE_HOST)){throw 'invalid'}
      if($null -ne $previous.version -and ($previous.version -ne 2 -or $previous.host -ne $env:WG_LEASE_HOST -or !$previous.token -or !$previous.processStartedAt)){throw 'invalid'}
      $alive=$true
      try { $owner=[Diagnostics.Process]::GetProcessById([int]$previous.pid); $owner.Dispose() }
      catch [ArgumentException] { $alive=$false }
      if($alive){[Console]::Out.WriteLine('SOCKET_LEASE_EXISTS');exit 1}
    } catch { [Console]::Out.WriteLine('SOCKET_LEASE_UNVERIFIED');exit 1 }
    # Only proven-dead PIDs are reclaimed. An active reused PID is deliberately
    # refused, regardless of creation time; uncertainty never grants ownership.
    [IO.File]::Delete($env:WG_LEASE_PATH)
  }
  $file=[IO.File]::Open($env:WG_LEASE_PATH,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read)
  try { $bytes=[Text.Encoding]::UTF8.GetBytes($env:WG_LEASE_RECORD);$file.Write($bytes,0,$bytes.Length);$file.Flush($true) } finally { $file.Dispose() }
  [Console]::Out.WriteLine('READY');[Console]::Out.Flush()
  $command=[Console]::In.ReadLine()
  if($command -eq 'release') {
    $current=[IO.File]::ReadAllText($env:WG_LEASE_PATH) | ConvertFrom-Json
    if($current.token -ne $env:WG_LEASE_TOKEN){throw 'ownership changed'}
    [IO.File]::Delete($env:WG_LEASE_PATH)
  }
} catch { [Console]::Out.WriteLine('SOCKET_LEASE_UNVERIFIED');exit 1 }
finally { if($guard){$guard.Dispose()} }
`;

export async function acquireSocketLease(root:string,id:string):Promise<()=>Promise<void>> {
  if(!/^[0-9a-f-]{36}$/i.test(id))throw codedError('SESSION_PATH_INVALID');
  const path=join(root,id+'.socket.lock'),token=randomUUID();
  const record={version:2,pid:process.pid,host:hostname(),token,
    processStartedAt:new Date(Date.now()-process.uptime()*1000).toISOString(),acquiredAt:new Date().toISOString()};
  if(process.platform!=='win32') {
    // Preserve the original conservative behavior outside the Windows target.
    let handle;try{handle=await open(path,'wx',0o600);}catch(error){
      throw codedError((error as NodeJS.ErrnoException).code==='EEXIST'?'SOCKET_LEASE_EXISTS':'SOCKET_LEASE_UNVERIFIED',409);
    }
    try{await handle.writeFile(JSON.stringify(record));await handle.sync();}finally{await handle.close();}
    return async()=>{const current=JSON.parse(await readFile(path,'utf8'));if(current.token!==token)throw codedError('SOCKET_LEASE_UNVERIFIED');await unlink(path);};
  }
  const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',windowsLease],{
    windowsHide:true,stdio:['pipe','pipe','ignore'],env:{...process.env,WG_LEASE_PATH:path,
      WG_LEASE_GUARD:join(root,id+'.socket.guard'),WG_LEASE_HOST:hostname(),WG_LEASE_TOKEN:token,WG_LEASE_RECORD:JSON.stringify(record)},
  });
  child.stdin.on('error',()=>undefined);
  const exited=new Promise<number|null>(resolve=>{child.once('exit',resolve);child.once('error',()=>resolve(null));});
  await new Promise<void>((resolve,reject)=>{
    let ready=false,output='';
    const timer=setTimeout(()=>{child.kill();reject(codedError('SOCKET_LEASE_UNVERIFIED',409));},15000);
    const fail=()=>{clearTimeout(timer);if(!ready)reject(codedError(output.includes('SOCKET_LEASE_EXISTS')?'SOCKET_LEASE_EXISTS':'SOCKET_LEASE_UNVERIFIED',409));};
    child.once('error',fail);child.once('exit',fail);
    child.stdout.on('data',chunk=>{output=(output+chunk.toString()).slice(-4096);if(!ready&&output.includes('READY')){ready=true;clearTimeout(timer);resolve();}});
  });
  let releasing:Promise<void>|undefined;
  return ()=>releasing??=(async()=>{
    if(child.exitCode!==null||child.signalCode!==null)throw codedError('SOCKET_LEASE_UNVERIFIED',409);
    child.stdin.end('release\n');
    const timer=setTimeout(()=>child.kill(),15000);
    try{if(await exited!==0)throw codedError('SOCKET_LEASE_UNVERIFIED',409);}finally{clearTimeout(timer);}
  })();
}
