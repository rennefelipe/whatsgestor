import { QueryRunner } from 'typeorm';
import { LinkWhatsappConversationsToContacts1791493160976 } from './1791493160976-LinkWhatsappConversationsToContacts';

describe('LinkWhatsappConversationsToContacts1791493160976', () => {
  it('adds a nullable contact link without changing existing conversation rows', async () => {
    const statements: string[] = [];
    const queryRunner = {
      query: jest.fn((sql: string) => {
        statements.push(sql);
        return Promise.resolve(undefined);
      }),
    } as unknown as QueryRunner;
    const migration = new LinkWhatsappConversationsToContacts1791493160976();

    await migration.up(queryRunner);

    expect(statements).toHaveLength(3);
    expect(statements[0]).toMatch(
      /ADD\s+\[contactId\]\s+uniqueidentifier\s+NULL/i,
    );
    expect(statements[1]).toMatch(
      /CREATE INDEX \[IX_whatsapp_conversations_contactId\]/i,
    );
    expect(statements[2]).toMatch(/ON DELETE SET NULL/i);
    expect(
      statements.some((statement) => /^\s*(UPDATE|DELETE)\b/i.test(statement)),
    ).toBe(false);
  });
});
