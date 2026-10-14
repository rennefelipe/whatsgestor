import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';
import { validMediaContent } from '../whatsapp-conversations/private-media-storage';

export interface AttachmentUpload {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}
export interface AttachmentMetadata {
  kind: 'image' | 'document';
  mimeType: string;
  originalName: string;
  size: number;
}
export function attachmentLimit(kind: 'image' | 'document'): number {
  const maximum = (kind === 'image' ? 5 : 20) * 1024 * 1024;
  const configured = Number(
    process.env[
      kind === 'image'
        ? 'WHATSAPP_UPLOAD_IMAGE_MAX_BYTES'
        : 'WHATSAPP_UPLOAD_PDF_MAX_BYTES'
    ],
  );
  return Number.isSafeInteger(configured) && configured > 0
    ? Math.min(maximum, configured)
    : maximum;
}
export async function validateAttachment(
  file?: AttachmentUpload,
): Promise<AttachmentMetadata> {
  if (!file?.buffer?.length || file.size !== file.buffer.length)
    throw new BadRequestException('Selecione um arquivo válido.');
  const extensions: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    pdf: 'application/pdf',
  };
  const rawName =
    (file.originalname ?? '').replace(/\\/g, '/').split('/').at(-1) ?? '';
  const extension = rawName.split('.').at(-1)?.toLowerCase() ?? '';
  const mimeType = extensions[extension];
  if (!mimeType || file.mimetype !== mimeType)
    throw new BadRequestException(
      'Extensão e tipo do arquivo devem corresponder a JPEG, PNG, WebP ou PDF.',
    );
  const kind = mimeType === 'application/pdf' ? 'document' : 'image';
  const limit = attachmentLimit(kind);
  if (file.size > limit)
    throw new PayloadTooLargeException(
      `O arquivo excede o limite configurado para ${kind === 'image' ? 'imagens' : 'PDFs'} (${limit.toLocaleString('pt-BR')} bytes).`,
    );
  if (!validMediaContent(mimeType, file.buffer.subarray(0, 32)))
    throw new BadRequestException(
      'O conteúdo não corresponde ao tipo informado.',
    );
  try {
    if (kind === 'image') {
      const decoder = sharp(file.buffer, {
        limitInputPixels: 16_000_000,
        failOn: 'warning',
      });
      const metadata = await decoder.metadata();
      const format = mimeType.split('/')[1];
      if (metadata.format !== format || (metadata.pages ?? 1) !== 1)
        throw Error('Invalid image format');
      await decoder.raw().toBuffer();
    } else {
      if (!/%%EOF\s*$/.test(file.buffer.subarray(-1024).toString('latin1')))
        throw Error('Incomplete PDF');
      const pdf = await PDFDocument.load(file.buffer, {
        ignoreEncryption: false,
        throwOnInvalidObject: true,
      });
      if (!pdf.getPageCount()) throw Error('Empty PDF');
      pdf.getPages().forEach((page) => page.getSize());
    }
  } catch {
    throw new BadRequestException(
      'Arquivo inválido, incompleto, protegido ou imagem acima de 16 megapixels.',
    );
  }
  const stem =
    rawName
      .slice(0, -(extension.length + 1))
      .normalize('NFC')
      .replace(/[^\p{L}\p{N} _.-]/gu, '_')
      .replace(/^[. ]+|[. ]+$/g, '')
      .slice(0, 160) || 'anexo';
  return {
    kind,
    mimeType,
    originalName: `${stem}.${extension}`,
    size: file.size,
  };
}
