import type { QueryRunner } from 'typeorm';
import { AddWhatsappMessageMedia1791600000000 } from './1791600000000-AddWhatsappMessageMedia';
describe('AddWhatsappMessageMedia migration', () => {
  it('only adds a media table and unique FK index; preserves all existing rows and tables', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    await new AddWhatsappMessageMedia1791600000000().up({
      query,
    } as unknown as QueryRunner);
    expect(query).toHaveBeenCalledTimes(2);
    const sql = query.mock.calls.map(([text]: [string]) => text).join(' ');
    expect(sql).toContain('CREATE TABLE [whatsapp_message_media]');
    expect(sql).toContain(
      'REFERENCES [whatsapp_messages]([id]) ON DELETE NO ACTION',
    );
    expect(sql).toContain('CREATE UNIQUE INDEX');
    expect(sql).not.toMatch(
      /\b(?:ALTER|UPDATE|INSERT|DROP|TRUNCATE)\b|DELETE FROM/i,
    );
  });
});
