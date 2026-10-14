import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import { attachmentFixture } from '../../test/attachment-fixture';
import { validateAttachment } from './attachment-validation';

describe('attachment validation', () => {
  it.each(['jpeg', 'png', 'webp', 'pdf'] as const)(
    'decodes valid %s and keeps its actual format',
    async (format) => {
      const file = await attachmentFixture(format);
      await expect(validateAttachment(file)).resolves.toMatchObject({
        mimeType: file.mimetype,
        kind: format === 'pdf' ? 'document' : 'image',
        size: file.size,
      });
    },
  );
  it('rejects mismatching extension or MIME, truncated formats and empty buffers', async () => {
    const png = await attachmentFixture('png');
    await expect(
      validateAttachment({ ...png, originalname: 'fake.pdf' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      validateAttachment({ ...png, mimetype: 'image/jpeg' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    const truncated = png.buffer.subarray(0, 16);
    await expect(
      validateAttachment({ ...png, buffer: truncated, size: truncated.length }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      validateAttachment({ ...png, buffer: Buffer.alloc(0), size: 0 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    const fake = Buffer.from('%PDF-1.7\nnot a PDF\n%%EOF');
    await expect(
      validateAttachment({
        buffer: fake,
        size: fake.length,
        originalname: 'fake.pdf',
        mimetype: 'application/pdf',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
  it.each([
    ['png', 5],
    ['pdf', 20],
  ] as const)(
    'rejects %s above its size limit before decoding',
    async (format, limit) => {
      const buffer = Buffer.alloc(limit * 1024 * 1024 + 1);
      await expect(
        validateAttachment({
          buffer,
          size: buffer.length,
          originalname: `large.${format}`,
          mimetype: format === 'pdf' ? 'application/pdf' : 'image/png',
        }),
      ).rejects.toBeInstanceOf(PayloadTooLargeException);
    },
  );
  it('sanitizes traversal/control characters without using the name as a storage path', async () => {
    const pdf = await attachmentFixture('pdf');
    const result = await validateAttachment({
      ...pdf,
      originalname: '../../folder\\bad\u0000<name>.pdf',
    });
    expect(result.originalName).toBe('bad__name_.pdf');
    expect(result.originalName).not.toMatch(/[\\/]/);
    expect(result.originalName.includes(String.fromCharCode(0))).toBe(false);
  });
  it('supports lower configured limits without raising the hard maximum', async () => {
    const before = process.env.WHATSAPP_UPLOAD_IMAGE_MAX_BYTES;
    try {
      process.env.WHATSAPP_UPLOAD_IMAGE_MAX_BYTES = '10';
      await expect(
        validateAttachment(await attachmentFixture('png')),
      ).rejects.toBeInstanceOf(PayloadTooLargeException);
    } finally {
      if (before === undefined)
        delete process.env.WHATSAPP_UPLOAD_IMAGE_MAX_BYTES;
      else process.env.WHATSAPP_UPLOAD_IMAGE_MAX_BYTES = before;
    }
  });
});
