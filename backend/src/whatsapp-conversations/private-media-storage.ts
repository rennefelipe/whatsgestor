import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm, open, lstat, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve, join, sep } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { IncomingMedia } from './incoming-media';

export function validMediaContent(mime: string, header: Buffer): boolean {
  if (mime === 'image/png')
    return header
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mime === 'image/jpeg')
    return header[0] === 255 && header[1] === 216 && header[2] === 255;
  if (mime === 'image/webp')
    return (
      header.toString('ascii', 0, 4) === 'RIFF' &&
      header.toString('ascii', 8, 12) === 'WEBP'
    );
  if (mime === 'application/pdf')
    return header.toString('ascii', 0, 5) === '%PDF-';
  if (mime === 'audio/ogg') return header.toString('ascii', 0, 4) === 'OggS';
  if (mime === 'audio/wav' || mime === 'audio/x-wav')
    return (
      header.toString('ascii', 0, 4) === 'RIFF' &&
      header.toString('ascii', 8, 12) === 'WAVE'
    );
  if (mime === 'audio/mp4')
    return (
      header.toString('ascii', 4, 8) === 'ftyp' &&
      ['M4A ', 'isom', 'mp42'].includes(header.toString('ascii', 8, 12))
    );
  if (mime === 'audio/mpeg')
    return (
      header.toString('ascii', 0, 3) === 'ID3' ||
      (header[0] === 255 && (header[1] & 224) === 224 && (header[1] & 6) !== 0)
    );
  if (mime === 'audio/aac')
    return header[0] === 255 && (header[1] & 246) === 240;
  return false;
}
export class PrivateMediaStorage {
  readonly root: string;
  constructor(
    directory = process.env.WHATSAPP_MEDIA_DIR ??
      join(homedir(), '.whatsgestor', 'media'),
  ) {
    this.root = resolve(directory);
    const project = resolve(__dirname, '../../..');
    if (this.root === project || this.root.startsWith(project + sep))
      throw new Error('WHATSAPP_MEDIA_DIR must be outside the project');
  }
  private path(key: string): string {
    if (!/^[0-9a-f-]{36}\.bin$/.test(key)) throw new Error('Invalid media key');
    return join(this.root, key);
  }
  async ensureRoot(): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const actualRoot = await realpath(this.root);
    const project = await realpath(resolve(__dirname, '../../..'));
    if (actualRoot === project || actualRoot.startsWith(project + sep))
      throw new Error('Media storage must remain outside the project');
  }
  async save(
    stream: Readable,
    metadata: IncomingMedia,
    signal: AbortSignal,
    reservedKey?: string,
  ): Promise<{ key: string; size: number }> {
    await this.ensureRoot();
    const key = reservedKey ?? randomUUID() + '.bin';
    const destination = this.path(key);
    const temporary = destination + '.part';
    const limit =
      metadata.kind === 'image'
        ? 5 * 1024 * 1024
        : metadata.kind === 'audio'
          ? 16 * 1024 * 1024
          : 20 * 1024 * 1024;
    let size = 0;
    let header = Buffer.alloc(0);
    const hash = createHash('sha256');
    const validate = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        size += chunk.length;
        if (size > limit)
          return callback(new Error('Media size limit exceeded'));
        if (header.length < 32)
          header = Buffer.concat([
            header,
            chunk.subarray(0, 32 - header.length),
          ]);
        hash.update(chunk);
        callback(null, chunk);
      },
    });
    try {
      await pipeline(
        stream,
        validate,
        createWriteStream(temporary, { flags: 'wx', mode: 0o600 }),
        { signal },
      );
      if (!size || !validMediaContent(metadata.mimeType, header))
        throw new Error('Invalid media content');
      const digest = hash.digest();
      if (
        metadata.expectedHash &&
        !digest.equals(Buffer.from(metadata.expectedHash))
      )
        throw new Error('Media hash mismatch');
      await rename(temporary, destination);
      return { key, size };
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
  }
  async read(key: string) {
    const path = this.path(key);
    if ((await lstat(path)).isSymbolicLink())
      throw new Error('Invalid media file');
    const handle = await open(path, 'r');
    try {
      const info = await handle.stat();
      if (!info.isFile()) throw new Error('Invalid media file');
      return { stream: handle.createReadStream(), size: info.size };
    } catch (error) {
      await handle.close();
      throw error;
    }
  }
  async remove(key: string): Promise<void> {
    await rm(this.path(key), { force: true });
  }
  async discardPrepared(key: string): Promise<void> {
    const path = this.path(key);
    await rm(path + '.part', { force: true });
    await rm(path, { force: true });
  }
  async sync(key: string): Promise<void> {
    const handle = await open(this.path(key), 'r+');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
}
