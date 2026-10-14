import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateWhatsappConversationContactDto } from './update-whatsapp-conversation-contact.dto';

describe('UpdateWhatsappConversationContactDto', () => {
  it('accepts a valid UUID', async () => {
    const dto = plainToInstance(UpdateWhatsappConversationContactDto, {
      contactId: '72098c86-0c7a-4af8-9756-6f7745d5e6e6',
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('accepts null for unlinking', async () => {
    const dto = plainToInstance(UpdateWhatsappConversationContactDto, {
      contactId: null,
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it.each([{ contactId: 'not-a-uuid' }, { contactId: undefined }, {}])(
    'rejects an invalid or missing contactId',
    async (payload) => {
      const dto = plainToInstance(
        UpdateWhatsappConversationContactDto,
        payload,
      );

      await expect(validate(dto)).resolves.not.toHaveLength(0);
    },
  );
});
