import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { FindWhatsappConversationsQueryDto } from './find-whatsapp-conversations-query.dto';
import { FindWhatsappMessagesQueryDto } from './find-whatsapp-messages-query.dto';

describe('WhatsApp conversation pagination DTOs', () => {
  it('applies pagination defaults', async () => {
    const conversations = plainToInstance(
      FindWhatsappConversationsQueryDto,
      {},
    );
    const messages = plainToInstance(FindWhatsappMessagesQueryDto, {});

    await expect(validate(conversations)).resolves.toHaveLength(0);
    await expect(validate(messages)).resolves.toHaveLength(0);
    expect(conversations).toMatchObject({ page: 1, pageSize: 50 });
    expect(messages).toMatchObject({ page: 1, pageSize: 50 });
  });

  it('rejects invalid connection IDs and out-of-range page sizes', async () => {
    const query = plainToInstance(FindWhatsappConversationsQueryDto, {
      connectionId: 'not-a-uuid',
      page: '0',
      pageSize: '101',
    });

    expect(await validate(query)).toHaveLength(3);
  });

  it('transforms valid pagination values to numbers', async () => {
    const query = plainToInstance(FindWhatsappMessagesQueryDto, {
      page: '3',
      pageSize: '25',
    });

    await expect(validate(query)).resolves.toHaveLength(0);
    expect(query).toMatchObject({ page: 3, pageSize: 25 });
  });
});
