import {
  BadRequestException,
  PayloadTooLargeException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { AttachmentUpload } from './attachment-validation';

export const AUDIO_UPLOAD_MAX_BYTES = 16 * 1024 * 1024;
export const AUDIO_MAX_DURATION_SECONDS = 5 * 60;
const AUDIO_TRANSCODE_TIMEOUT_MS = 60_000;
const OGG_GRANULE_UNSET = 0xffff_ffff_ffff_ffffn;

export interface AudioMetadata {
  kind: 'audio';
  mimeType: 'audio/ogg';
  originalName: string;
  size: number;
  durationSeconds: number;
}

export interface NormalizedAudio {
  buffer: Buffer;
  metadata: AudioMetadata;
}

export type AudioTranscoder = (input: Buffer) => Promise<Buffer>;
export type AudioSpawn = (
  command: string,
  args: readonly string[],
  options: {
    shell: false;
    windowsHide: true;
    stdio: ['pipe', 'pipe', 'pipe'];
  },
) => ChildProcessWithoutNullStreams;

export const AUDIO_FFMPEG_ARGUMENTS = [
  '-hide_banner',
  '-loglevel',
  'error',
  '-nostdin',
  '-i',
  'pipe:0',
  '-map_metadata',
  '-1',
  '-vn',
  '-ac',
  '1',
  '-ar',
  '48000',
  '-c:a',
  'libopus',
  '-application',
  'voip',
  '-b:a',
  '32k',
  '-vbr',
  'on',
  '-avoid_negative_ts',
  'make_zero',
  '-f',
  'ogg',
  'pipe:1',
] as const;

function configuredAudioLimit(): number {
  const configured = Number(process.env.WHATSAPP_UPLOAD_AUDIO_MAX_BYTES);
  return Number.isSafeInteger(configured) && configured > 0
    ? Math.min(AUDIO_UPLOAD_MAX_BYTES, configured)
    : AUDIO_UPLOAD_MAX_BYTES;
}

function validInputHeader(mimeType: string, buffer: Buffer): boolean {
  if (mimeType === 'audio/webm')
    return buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  if (mimeType === 'audio/ogg')
    return buffer.toString('ascii', 0, 4) === 'OggS';
  return mimeType === 'audio/mp4' && buffer.toString('ascii', 4, 8) === 'ftyp';
}

function oggDurationSeconds(buffer: Buffer): number {
  let offset = 0;
  let expectedSequence = 0;
  let serial: number | undefined;
  let finalGranule: bigint | undefined;
  let preSkip: number | undefined;
  let endOfStream = false;
  while (offset < buffer.length) {
    if (
      offset + 27 > buffer.length ||
      buffer.toString('ascii', offset, offset + 4) !== 'OggS' ||
      buffer[offset + 4] !== 0
    )
      throw new BadRequestException(
        'Não foi possível validar o áudio convertido.',
      );
    const pageSegments = buffer[offset + 26];
    const headerEnd = offset + 27 + pageSegments;
    if (headerEnd > buffer.length)
      throw new BadRequestException(
        'Não foi possível validar o áudio convertido.',
      );
    let bodySize = 0;
    for (let index = offset + 27; index < headerEnd; index++)
      bodySize += buffer[index];
    const pageEnd = headerEnd + bodySize;
    if (pageEnd > buffer.length)
      throw new BadRequestException(
        'Não foi possível validar o áudio convertido.',
      );
    const pageSerial = buffer.readUInt32LE(offset + 14);
    const sequence = buffer.readUInt32LE(offset + 18);
    if (
      (serial !== undefined && serial !== pageSerial) ||
      sequence !== expectedSequence
    )
      throw new BadRequestException(
        'Não foi possível validar o áudio convertido.',
      );
    serial = pageSerial;
    expectedSequence++;
    if (offset === 0) {
      if (
        !(buffer[offset + 5] & 0x02) ||
        !pageSegments ||
        buffer[offset + 27] < 19 ||
        buffer.toString('ascii', headerEnd, headerEnd + 8) !== 'OpusHead' ||
        buffer[headerEnd + 8] !== 1 ||
        buffer[headerEnd + 9] !== 1
      )
        throw new BadRequestException(
          'O áudio convertido não está em Ogg/Opus mono.',
        );
      preSkip = buffer.readUInt16LE(headerEnd + 10);
    }
    const granule = buffer.readBigUInt64LE(offset + 6);
    if (granule !== OGG_GRANULE_UNSET) finalGranule = granule;
    endOfStream = !!(buffer[offset + 5] & 0x04);
    offset = pageEnd;
  }
  if (
    offset !== buffer.length ||
    !endOfStream ||
    preSkip === undefined ||
    finalGranule === undefined ||
    finalGranule <= BigInt(preSkip)
  )
    throw new BadRequestException(
      'Não foi possível validar a duração do áudio.',
    );
  const duration = Number(finalGranule - BigInt(preSkip)) / 48_000;
  if (!Number.isFinite(duration) || duration <= 0)
    throw new BadRequestException(
      'Não foi possível validar a duração do áudio.',
    );
  // Opus may add a few milliseconds of encoder padding at the five-minute edge.
  if (duration > AUDIO_MAX_DURATION_SECONDS + 0.5)
    throw new PayloadTooLargeException(
      'A gravação deve ter no máximo 5 minutos.',
    );
  return Math.max(
    1,
    Math.min(AUDIO_MAX_DURATION_SECONDS, Math.round(duration)),
  );
}

function conversionUnavailable(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    ['ENOENT', 'EACCES', 'EPERM'].includes(String(error.code))
  );
}

export function transcodeRecordedAudio(
  input: Buffer,
  spawnProcess: AudioSpawn = spawn,
): Promise<Buffer> {
  const executable = process.env.WHATSAPP_FFMPEG_PATH?.trim() || 'ffmpeg';
  return new Promise((resolve, reject) => {
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawnProcess(executable, AUDIO_FFMPEG_ARGUMENTS, {
        shell: false,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error) {
      reject(
        conversionUnavailable(error)
          ? new ServiceUnavailableException(
              'Conversão de áudio indisponível no backend.',
            )
          : error instanceof Error
            ? error
            : new Error('Falha inesperada ao iniciar a conversão de áudio.'),
      );
      return;
    }
    const chunks: Buffer[] = [];
    let outputSize = 0;
    let settled = false;
    const finish = (error?: Error, output?: Buffer) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(output!);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(
        new ServiceUnavailableException(
          'A conversão do áudio excedeu o tempo permitido.',
        ),
      );
    }, AUDIO_TRANSCODE_TIMEOUT_MS);
    timer.unref();
    child.once('error', (error) =>
      finish(
        conversionUnavailable(error)
          ? new ServiceUnavailableException(
              'Conversão de áudio indisponível no backend.',
            )
          : new BadRequestException('Não foi possível converter a gravação.'),
      ),
    );
    child.stdout.on('data', (chunk: Buffer | string) => {
      if (settled) return;
      const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      outputSize += value.length;
      if (outputSize > AUDIO_UPLOAD_MAX_BYTES) {
        child.kill();
        finish(
          new PayloadTooLargeException(
            'O áudio convertido excede o limite de 16 MiB.',
          ),
        );
        return;
      }
      chunks.push(value);
    });
    // Consume diagnostics so the child cannot block on a full stderr pipe. Do
    // not log it because decoder output may contain untrusted metadata.
    child.stderr.on('data', () => undefined);
    child.stdin.once('error', () =>
      finish(new BadRequestException('Não foi possível converter a gravação.')),
    );
    child.once('close', (code) => {
      if (settled) return;
      if (code !== 0)
        finish(new BadRequestException('A gravação de áudio é inválida.'));
      else finish(undefined, Buffer.concat(chunks, outputSize));
    });
    child.stdin.end(input);
  });
}

export async function normalizeRecordedAudio(
  file?: AttachmentUpload,
  transcode: AudioTranscoder = transcodeRecordedAudio,
): Promise<NormalizedAudio> {
  if (!file?.buffer?.length || file.size !== file.buffer.length)
    throw new BadRequestException('Grave um áudio válido antes de enviar.');
  const rawName =
    (file.originalname ?? '').replace(/\\/g, '/').split('/').at(-1) ?? '';
  const extension = rawName.split('.').at(-1)?.toLowerCase() ?? '';
  const mimeType = file.mimetype.split(';')[0].trim().toLowerCase();
  const expectedMime: Record<string, string> = {
    webm: 'audio/webm',
    ogg: 'audio/ogg',
    oga: 'audio/ogg',
    mp4: 'audio/mp4',
    m4a: 'audio/mp4',
  };
  if (expectedMime[extension] !== mimeType)
    throw new BadRequestException(
      'O formato da gravação deve ser WebM, Ogg ou MP4 e corresponder ao tipo informado.',
    );
  const limit = configuredAudioLimit();
  if (file.size > limit)
    throw new PayloadTooLargeException(
      `A gravação excede o limite configurado (${limit.toLocaleString('pt-BR')} bytes).`,
    );
  if (!validInputHeader(mimeType, file.buffer))
    throw new BadRequestException(
      'O conteúdo da gravação não corresponde ao tipo informado.',
    );
  const buffer = await transcode(file.buffer);
  if (!buffer.length || buffer.length > AUDIO_UPLOAD_MAX_BYTES)
    throw new PayloadTooLargeException(
      'O áudio convertido excede o limite de 16 MiB.',
    );
  const durationSeconds = oggDurationSeconds(buffer);
  return {
    buffer,
    metadata: {
      kind: 'audio',
      mimeType: 'audio/ogg',
      originalName: 'gravacao.ogg',
      size: buffer.length,
      durationSeconds,
    },
  };
}
