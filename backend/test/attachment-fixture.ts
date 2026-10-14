import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';
import type { AttachmentUpload } from '../src/whatsapp-connections/attachment-validation';
export async function attachmentFixture(
  format: 'jpeg' | 'png' | 'webp' | 'pdf',
): Promise<AttachmentUpload> {
  let buffer: Buffer;
  if (format === 'pdf') {
    const pdf = await PDFDocument.create();
    pdf.addPage([100, 100]);
    buffer = Buffer.from(await pdf.save());
  } else
    buffer = await sharp({
      create: {
        width: 8,
        height: 6,
        channels: 3,
        background: { r: 20, g: 80, b: 60 },
      },
    })
      .toFormat(format)
      .toBuffer();
  return {
    buffer,
    size: buffer.length,
    originalname: `teste.${format}`,
    mimetype: format === 'pdf' ? 'application/pdf' : `image/${format}`,
  };
}
