import {
  BadRequestException,
  PayloadTooLargeException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import {
  AUDIO_FFMPEG_ARGUMENTS,
  AUDIO_UPLOAD_MAX_BYTES,
  normalizeRecordedAudio,
  transcodeRecordedAudio,
  type AudioSpawn,
} from './outbound-audio';
import type { AttachmentUpload } from './attachment-validation';

function oggOpus(seconds: number, channels = 1): Buffer {
  const serial = 7;
  const page = (
    headerType: number,
    granule: bigint,
    sequence: number,
    body: Buffer,
  ) => {
    const header = Buffer.alloc(28);
    header.write('OggS', 0, 'ascii');
    header[4] = 0;
    header[5] = headerType;
    header.writeBigUInt64LE(granule, 6);
    header.writeUInt32LE(serial, 14);
    header.writeUInt32LE(sequence, 18);
    header[26] = 1;
    header[27] = body.length;
    return Buffer.concat([header, body]);
  };
  const head = Buffer.alloc(19);
  head.write('OpusHead', 0, 'ascii');
  head[8] = 1;
  head[9] = channels;
  head.writeUInt16LE(312, 10);
  head.writeUInt32LE(48_000, 12);
  return Buffer.concat([
    page(0x02, 0n, 0, head),
    page(0x04, BigInt(312 + seconds * 48_000), 1, Buffer.from([0])),
  ]);
}

function upload(format: 'webm' | 'ogg' | 'mp4'): AttachmentUpload {
  const headers = {
    webm: Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x01]),
    ogg: Buffer.from('OggS synthetic'),
    mp4: Buffer.from([
      0, 0, 0, 16, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d,
    ]),
  };
  const mime = {
    webm: 'audio/webm;codecs=opus',
    ogg: 'audio/ogg; codecs=opus',
    mp4: 'audio/mp4',
  };
  return {
    buffer: headers[format],
    size: headers[format].length,
    originalname: `gravacao.${format}`,
    mimetype: mime[format],
  };
}

function successfulSpawn(output: Buffer) {
  const call = jest.fn((...parameters: Parameters<AudioSpawn>) => {
    void parameters;
    const child = new EventEmitter() as ChildProcessWithoutNullStreams;
    Object.assign(child, {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: jest.fn(),
    });
    child.stdin.once('finish', () => {
      (child.stdout as PassThrough).end(output);
      (child.stderr as PassThrough).end();
      setImmediate(() => child.emit('close', 0, null));
    });
    return child;
  }) as jest.MockedFunction<AudioSpawn>;
  return call;
}

describe('recorded audio normalization', () => {
  it.each(['webm', 'ogg', 'mp4'] as const)(
    'accepts a real browser %s declaration and normalizes metadata to Ogg/Opus',
    async (format) => {
      const output = oggOpus(12);
      const transcode = jest.fn().mockResolvedValue(output);
      await expect(
        normalizeRecordedAudio(upload(format), transcode),
      ).resolves.toEqual({
        buffer: output,
        metadata: {
          kind: 'audio',
          mimeType: 'audio/ogg',
          originalName: 'gravacao.ogg',
          size: output.length,
          durationSeconds: 12,
        },
      });
      expect(transcode).toHaveBeenCalledWith(upload(format).buffer);
    },
  );

  it('rejects an empty recording, MIME/extension mismatch and forged content before conversion', async () => {
    const transcode = jest.fn();
    await expect(
      normalizeRecordedAudio(
        { ...upload('webm'), buffer: Buffer.alloc(0), size: 0 },
        transcode,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      normalizeRecordedAudio(
        { ...upload('webm'), originalname: 'gravacao.ogg' },
        transcode,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      normalizeRecordedAudio(
        { ...upload('webm'), buffer: Buffer.from('forged'), size: 6 },
        transcode,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(transcode).not.toHaveBeenCalled();
  });

  it('enforces 16 MiB input/output and five-minute normalized duration', async () => {
    const oversized = Buffer.alloc(AUDIO_UPLOAD_MAX_BYTES + 1);
    oversized.set([0x1a, 0x45, 0xdf, 0xa3]);
    await expect(
      normalizeRecordedAudio({
        ...upload('webm'),
        buffer: oversized,
        size: oversized.length,
      }),
    ).rejects.toBeInstanceOf(PayloadTooLargeException);
    await expect(
      normalizeRecordedAudio(upload('webm'), () =>
        Promise.resolve(oggOpus(301)),
      ),
    ).rejects.toBeInstanceOf(PayloadTooLargeException);
    await expect(
      normalizeRecordedAudio(upload('webm'), () =>
        Promise.resolve(Buffer.alloc(AUDIO_UPLOAD_MAX_BYTES + 1)),
      ),
    ).rejects.toBeInstanceOf(PayloadTooLargeException);
  });

  it('uses fixed FFmpeg arguments, pipes only and never invokes a shell', async () => {
    const output = oggOpus(3);
    const spawnProcess = successfulSpawn(output);
    await expect(
      transcodeRecordedAudio(Buffer.from('input'), spawnProcess),
    ).resolves.toEqual(output);
    expect(spawnProcess).toHaveBeenCalledWith(
      process.env.WHATSAPP_FFMPEG_PATH?.trim() || 'ffmpeg',
      AUDIO_FFMPEG_ARGUMENTS,
      { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
    );
  });

  it('reports a missing FFmpeg executable without creating a media attempt', async () => {
    const unavailable = jest.fn(() => {
      const error = new Error('missing') as NodeJS.ErrnoException;
      error.code = 'ENOENT';
      throw error;
    }) as unknown as jest.MockedFunction<AudioSpawn>;
    await expect(
      transcodeRecordedAudio(Buffer.from('input'), unavailable),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('rejects malformed Ogg output even when conversion reports success', async () => {
    await expect(
      normalizeRecordedAudio(upload('webm'), () =>
        Promise.resolve(Buffer.from('OggS incomplete')),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      normalizeRecordedAudio(upload('webm'), () =>
        Promise.resolve(oggOpus(3, 2)),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
