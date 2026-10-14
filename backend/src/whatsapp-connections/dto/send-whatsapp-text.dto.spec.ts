import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SendWhatsappTextDto } from './send-whatsapp-text.dto';

describe('SendWhatsappTextDto', () => {
  it('rejects empty and whitespace-only text', async () => {
    for (const textContent of ['', '   \n']) {
      const dto = plainToInstance(SendWhatsappTextDto, { textContent });
      expect(await validate(dto)).not.toHaveLength(0);
    }
  });

  it('rejects text exceeding the length limit', async () => {
    const dto = plainToInstance(SendWhatsappTextDto, {
      textContent: 'a'.repeat(4001),
    });

    expect(await validate(dto)).not.toHaveLength(0);
  });

  it('accepts valid text without trimming its content', async () => {
    const dto = plainToInstance(SendWhatsappTextDto, {
      textContent: '  hello  ',
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
    expect(dto.textContent).toBe('  hello  ');
  });
});
