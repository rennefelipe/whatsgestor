import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { open, readdir, rename, unlink, lstat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { FilePolicy } from '../messages/file-policy';
import { PrivateFileStorage } from '../messages/private-file-storage';
import { codedError, type StateStore } from './contracts';
import { stateReplacer,stateReviver } from './state-codec';
import { storageError } from './storage-diagnostics';

@Injectable()
export class EncryptedStateStore implements StateStore {
  readonly root: string;
  private readonly directory: PrivateFileStorage;
  private keyPromise?: Promise<Buffer>;
  private readonly locks = new Map<string, Promise<unknown>>();
  constructor(config: ConfigService) {
    this.root = config.get<string>('WHATSAPP_INTEGRATION_STATE_DIR') ?? join(homedir(), '.whatsgestor', 'integration-state');
    this.directory = new PrivateFileStorage(new FilePolicy(new ConfigService({ WHATSAPP_MEDIA_DIR: this.root })));
  }
  private filename(namespace: string, key: string) {
    if (!/^[a-z-]{1,30}$/.test(namespace)) throw codedError('INVALID_STATE_NAMESPACE');
    return join(this.root, namespace + '--' + createHash('sha256').update(key).digest('hex') + '.enc');
  }
  private async key(): Promise<Buffer> {
    this.keyPromise ??= (async () => {
      await this.directory.verifyRoot(true);
      const path = join(this.root, 'master.key');
      try { await lstat(path); } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        if ((await readdir(this.root)).some((name) => name.endsWith('.enc')||name.endsWith('.part'))) throw codedError('STATE_KEY_MISSING');
      }
      try {
        const handle = await open(path, 'wx', 0o600);
        try { const value = randomBytes(32); await handle.writeFile(value); await handle.sync(); return value; }
        finally { await handle.close(); }
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw storageError('STATE_KEY_UNAVAILABLE',error); }
      const info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size !== 32) throw codedError('STATE_KEY_INVALID');
      const handle = await open(path, constants.O_RDONLY|(constants.O_NOFOLLOW??0));
      try { const opened=await handle.stat();if(opened.ino!==info.ino||opened.dev!==info.dev||opened.size!==32||opened.nlink!==1)throw codedError('STATE_KEY_INVALID');return await handle.readFile(); } finally { await handle.close(); }
    })();
    return this.keyPromise;
  }
  private async read(path: string,namespace:string): Promise<any | null> {
    try {
      await this.directory.verifyRoot();
      const info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 2 * 1024 * 1024) throw codedError('STATE_FILE_INVALID');
      const handle = await open(path, constants.O_RDONLY|(constants.O_NOFOLLOW??0));
      let bytes;
      try {const after=await handle.stat();if(after.ino!==info.ino||after.dev!==info.dev||after.nlink!==1||after.size>2*1024*1024)throw codedError('STATE_FILE_INVALID');bytes = await handle.readFile(); } finally { await handle.close(); }
      if (bytes.length < 29 || ![1,2].includes(bytes[0])) throw codedError('STATE_FILE_INVALID');
      const decipher = createDecipheriv('aes-256-gcm', await this.key(), bytes.subarray(1, 13));
      if(bytes[0]===2)decipher.setAAD(Buffer.from(namespace+'|'+path.slice(path.lastIndexOf('--')+2,-4)));
      decipher.setAuthTag(bytes.subarray(13, 29));
      const value=JSON.parse(Buffer.concat([decipher.update(bytes.subarray(29)), decipher.final()]).toString('utf8'), stateReviver);
      if(bytes[0]===2&&value.namespace!==namespace)throw codedError('STATE_NAMESPACE_MISMATCH');
      return value;
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw storageError('STATE_READ_FAILED',error,{operation:'read',namespace}); }
  }
  private async ordered<T>(file:string,work:()=>Promise<T>):Promise<T>{
    const next=(this.locks.get(file)??Promise.resolve()).catch(()=>undefined).then(work);
    this.locks.set(file,next);
    try{return await next;}finally{if(this.locks.get(file)===next)this.locks.delete(file);}
  }
  async get<T>(namespace: string, key: string): Promise<T | null> {
    const path=this.filename(namespace,key);
    return this.ordered(path,async()=>{
    const envelope = await this.read(path,namespace);
    if (!envelope) return null;
    if (envelope.key !== key) throw codedError('STATE_KEY_MISMATCH');
    return envelope.value;
    });
  }
  async put(namespace: string, key: string, value: unknown): Promise<void> {
    const file = this.filename(namespace, key);
    // Serialize at submission, before waiting: callers may mutate their object.
    const bytes = Buffer.from(JSON.stringify({ namespace,key, value },stateReplacer));
    if (bytes.length > 1024 * 1024) throw storageError('STATE_RECORD_LIMIT',undefined,{operation:'put',namespace,recordBytes:bytes.length,limitBytes:1024*1024});
    return this.ordered(file,async () => {
      let phase='read_previous';
      // Refuse to replace an unreadable previous record. Corruption is evidence,
      // not permission to silently regenerate auth or overwrite a pending event.
      await this.read(file,namespace);
      try{
      phase='key';const master=await this.key();
      phase='encrypt';
      const iv = randomBytes(12), encrypt = createCipheriv('aes-256-gcm', master, iv);
      encrypt.setAAD(Buffer.from(namespace+'|'+createHash('sha256').update(key).digest('hex')));
      const encrypted = Buffer.concat([encrypt.update(bytes), encrypt.final()]);
      const temporary = file + '.' + randomUUID() + '.part';
      phase='open_temporary';
      const handle = await open(temporary, 'wx', 0o600);
      phase='write_sync';
      try { await handle.writeFile(Buffer.concat([Buffer.from([2]), iv, encrypt.getAuthTag(), encrypted])); await handle.sync(); }
      finally { await handle.close(); }
      phase='verify_before_publish';await this.directory.verifyRoot();
      phase='rename';
      await rename(temporary, file);
      }catch(cause){
        // Preserve established key safety codes for operators and callers.
        if(phase==='key')throw cause;
        throw storageError('STATE_WRITE_FAILED',cause,{operation:'put',namespace,phase,recordBytes:bytes.length});
      }
    });
  }
  async remove(namespace: string, key: string): Promise<void> {
    const file = this.filename(namespace, key);
    return this.ordered(file,async()=>{
      await this.directory.verifyRoot();
      // Only an application-owned sealed journal file; never a legacy session.
      await this.read(file,namespace);
      await unlink(file).catch((error) => { if (error.code !== 'ENOENT') throw storageError('STATE_REMOVE_FAILED',error,{operation:'remove',namespace}); });
    });
  }
  async entries<T>(namespace: string): Promise<Array<{ key: string; value: T }>> {
    this.filename(namespace, 'validate');
    let names;
    try { await this.directory.verifyRoot(); names = await readdir(this.root); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
    const result = [];
    for (const name of names.filter((n) => new RegExp('^' + namespace + '--[0-9a-f]{64}\\.enc$').test(n))) {
      const file=join(this.root,name);const entry = await this.ordered(file,()=>this.read(file,namespace));
      if (entry) result.push(entry);
    }
    return result;
  }
}
