import { Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { constants } from 'node:fs';
import { mkdir, lstat, open, realpath, rename, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve, sep } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { FilePolicy, type FileMetadata } from './file-policy';

@Injectable()
export class PrivateFileStorage {
  readonly root: string;
  private checkedAcl?: { inode: number; device: number; checkedAt: number };
  private checkingAcl?: Promise<void>;
  constructor(private readonly policy: FilePolicy) {
    const configured = policy.storageDirectory;
    if (configured && !isAbsolute(configured)) throw new Error('WHATSAPP_MEDIA_DIR deve ser absoluto.');
    this.root = resolve(configured ?? join(homedir(), '.whatsgestor', 'media'));
    this.assertOutsideProject(this.root);
  }
  private assertOutsideProject(directory: string) {
    const project = resolve(__dirname, '../../..');
    const normalized = (p: string) => process.platform === 'win32' ? p.toLowerCase() : p;
    const root = normalized(directory), protectedRoot = normalized(project);
    if (root === protectedRoot || root.startsWith(protectedRoot + sep) || root === normalized(resolve(directory, sep))) throw new Error('Armazenamento deve ficar fora do projeto e da raiz do sistema.');
  }
  private path(key: string): string {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.bin$/.test(key)) throw new NotFoundException('Arquivo indisponivel.');
    return join(this.root, key);
  }
  private async checkRoot(create = false):Promise<void> {
    // Check existing ancestors before mkdir can follow a junction into another
    // directory. Missing components are allowed only during explicit creation.
    let candidate = this.root;
    for (;;) {
      try { if ((await lstat(candidate)).isSymbolicLink()) throw new Error('Armazenamento redirecionado.'); }
      catch (error) { if (!create || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      const parent = resolve(candidate, '..');
      if (parent === candidate) break;
      candidate = parent;
    }
    if (create) await mkdir(this.root, { recursive: true, mode: 0o700 });
    const info = await lstat(this.root);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Armazenamento inseguro.');
    const actual = await realpath(this.root);
    this.assertOutsideProject(actual);
    let ancestor = this.root;
    for (;;) {
      if ((await lstat(ancestor)).isSymbolicLink()) throw new Error('Armazenamento redirecionado.');
      const parent = resolve(ancestor, '..');
      if (parent === ancestor) break;
      ancestor = parent;
    }
    if (process.platform !== 'win32' && (info.mode & 0o077)) throw new Error('Permissoes de armazenamento inseguras.');
    // On Windows directory ctime changes on child creation/rename as well as
    // ACL changes. Using it as an ACL cache key spawned PowerShell twice per
    // key write (hundreds of pre-keys), with a fatal 10s startup timeout.
    // Bound ACL staleness to one second; path/inode checks still run every time.
    if (process.platform === 'win32' && (this.checkedAcl?.inode !== info.ino || this.checkedAcl?.device !== info.dev || Date.now()-this.checkedAcl.checkedAt >= 1000)) {
      if(this.checkingAcl){await this.checkingAcl;return this.checkRoot(false);}
      const checking=this.inspectWindowsAcl().then(()=>{this.checkedAcl={inode:info.ino,device:info.dev,checkedAt:Date.now()};});
      this.checkingAcl=checking;
      try{await checking;}finally{if(this.checkingAcl===checking)this.checkingAcl=undefined;}
    }
  }
  private async inspectWindowsAcl():Promise<void>{
      // Inspect ACLs without changing any existing directory or inherited ACL.
      // Values travel through the environment, never shell interpolation.
      // Preserve explicit operator/service-account permissions. Refuse broad
      // public groups instead of rewriting existing named-account ACLs.
      const script = "$ErrorActionPreference='Stop'; " +
        "$public=@('S-1-1-0','S-1-5-11','S-1-5-32-545','S-1-5-32-546','S-1-5-7','S-1-15-2-1','S-1-15-2-2'); $unsafe=$false; " +
        "foreach($rule in (Get-Acl -LiteralPath $env:WG_PRIVATE_FILE_ROOT).Access) { " +
        "if($rule.AccessControlType -eq 'Allow' -and (($rule.FileSystemRights.value__ -band 851975) -ne 0)) { " +
        "$sid=$rule.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value; if($sid -in $public -or $sid -match '^S-1-5-21-.+-(513|514)$'){$unsafe=$true} } }; " +
        "if($unsafe){exit 2}";
      for(let attempt=0;;attempt++){
        try{
          await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
            env: { ...process.env, WG_PRIVATE_FILE_ROOT: this.root }, windowsHide: true, timeout: attempt===0?10000:30000, maxBuffer: 1024,
          });return;
        }catch(cause){
          const error=cause as NodeJS.ErrnoException&{killed?:boolean};
          const timeout=error.killed===true||error.code==='ETIMEDOUT';
          if(timeout&&attempt===0)continue; // Retry inspection only; never bypass ACLs.
          throw Object.assign(new Error('PRIVATE_ACL_CHECK_FAILED'),{code:timeout?'PRIVATE_ACL_CHECK_TIMEOUT':(cause as any)?.code===2?'PRIVATE_ACL_UNSAFE':'PRIVATE_ACL_CHECK_FAILED',cause});
        }
      }
  }
  /** Shared private-directory boundary; verification does not modify existing ACLs. */
  async verifyRoot(create = false): Promise<void> { await this.checkRoot(create); }
  async save(content: Buffer, input: FileMetadata, references?: { conversationId: string; messageId: string }) {
    const metadata = this.policy.validate(content, input);
    const key = randomUUID() + '.bin', file = this.path(key), temporary = file + '.part';
    let published = false;
    try {
      await this.checkRoot(true);
      const handle = await open(temporary, 'wx', 0o600);
      try { await handle.writeFile(content); await handle.sync(); } finally { await handle.close(); }
      await this.checkRoot();
      await rename(temporary, file); published = true;
      const manifest = await open(file + '.json', 'wx', 0o600);
      try { await manifest.writeFile(JSON.stringify({ version: 1, sha256: metadata.sha256, size: metadata.sizeBytes,
        metadata: this.policy.metadata(metadata), references,
        semanticKind: metadata.kind, width: metadata.width, height: metadata.height })); await manifest.sync(); }
      finally { await manifest.close(); }
      return { key, size: metadata.sizeBytes, sha256: metadata.sha256 };
    } catch {
      try { await this.checkRoot(); await unlink(temporary); } catch { /* Never clean up through a redirected directory. */ }
      // Once published, retain the private file for recovery; never delete a
      // possibly referenced object after an ambiguous SQL/IO outcome.
      throw new ServiceUnavailableException(published ? 'Arquivo preservado; publicacao de metadados pendente.' : 'Armazenamento de arquivo indisponivel.');
    }
  }
  async open(key: string) {
    const path = this.path(key);
    try {
      await this.checkRoot();
      const before = await lstat(path);
      if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1) throw new Error();
      const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      try {
        const after = await handle.stat();
        await this.checkRoot();
        if (!after.isFile() || after.nlink !== 1 || before.ino !== after.ino || before.dev !== after.dev) throw new Error();
        return { handle, size: after.size };
      } catch (error) { await handle.close(); throw error; }
    } catch { throw new NotFoundException('Arquivo indisponivel.'); }
  }
  async digest(key: string) {
    const { handle } = await this.open(key);
    const hash = createHash('sha256');
    try { for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk); return hash.digest('hex'); }
    finally { await handle.close(); }
  }
  private async manifest(key: string) {
    this.path(key);
    try {
      await this.checkRoot();
      const path = this.path(key) + '.json', info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 2048) return null;
      const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      try {
        const stat = await handle.stat();
        if (info.ino !== stat.ino || info.dev !== stat.dev || stat.size > 2048) return null;
        return JSON.parse(await handle.readFile('utf8'));
      } finally { await handle.close(); }
    } catch { return null; }
  }
  async extra(key: string): Promise<{ semanticKind?: string; width?: number; height?: number }> {
    const data = await this.manifest(key);
    if (!data) return {}; // Legacy files have no sidecar. SQL remains authoritative.
    return { ...(['image','audio','video','document'].includes(data.semanticKind) ? { semanticKind: data.semanticKind } : {}),
          ...(Number.isInteger(data.width) && data.width > 0 ? { width: data.width } : {}),
          ...(Number.isInteger(data.height) && data.height > 0 ? { height: data.height } : {}) };
  }
  async recoverable(key: string, references: { conversationId: string; messageId: string }) {
    const manifest = await this.manifest(key);
    if (!manifest || manifest.version !== 1 || manifest.references?.messageId !== references.messageId ||
      manifest.references?.conversationId !== references.conversationId || !/^[0-9a-f]{64}$/.test(manifest.sha256)) {
      throw new NotFoundException('Arquivo recuperavel nao encontrado para esta mensagem.');
    }
    const metadata = this.policy.metadata(manifest.metadata);
    const file = await this.open(key);
    try {
      if (file.size > this.policy.limits[metadata.kind]) throw new ServiceUnavailableException('Arquivo excede o limite de recuperacao.');
      const content = await file.handle.readFile();
      const validated = this.policy.validate(content, metadata);
      if (validated.sha256 !== manifest.sha256 || file.size !== manifest.size) throw new ServiceUnavailableException('Integridade do arquivo nao confirmada.');
      return { content, metadata, key, size: file.size, sha256: validated.sha256 };
    } finally { await file.handle.close(); }
  }
}
