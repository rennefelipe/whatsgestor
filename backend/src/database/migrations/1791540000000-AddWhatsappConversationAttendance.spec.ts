import { QueryRunner } from 'typeorm';
import { AddWhatsappConversationAttendance1791540000000 } from './1791540000000-AddWhatsappConversationAttendance';

describe('AddWhatsappConversationAttendance1791540000000', () => {
  it('adds default waiting, nullable fields, constraints and indexes without rewriting business data', async () => {
    const statements: string[] = [];
    const runner = {
      query: jest.fn((sql: string) => {
        statements.push(sql);
        return Promise.resolve(undefined);
      }),
    } as unknown as QueryRunner;
    await new AddWhatsappConversationAttendance1791540000000().up(runner);
    expect(statements).toHaveLength(5);
    expect(statements[0]).toMatch(
      /\[attendanceStatus\] nvarchar\(20\) NOT NULL/,
    );
    expect(statements[0]).toMatch(/DEFAULT \(N'waiting'\) WITH VALUES/);
    for (const field of [
      'assignedUserId',
      'attendanceStartedAt',
      'attendanceFinishedAt',
    ]) {
      expect(statements[0]).toContain(`[${field}]`);
    }
    expect(statements[0]).toMatch(/\[assignedUserId\] uniqueidentifier NULL/);
    expect(statements[0]).toMatch(/\[attendanceStartedAt\] datetime2 NULL/);
    expect(statements[0]).toMatch(/\[attendanceFinishedAt\] datetime2 NULL/);
    expect(statements[1]).toContain(
      "CHECK ([attendanceStatus] IN (N'waiting', N'in_progress', N'finished'))",
    );
    expect(statements[2]).toContain(
      'REFERENCES [users]([id]) ON DELETE NO ACTION',
    );
    expect(statements[3]).toContain('([attendanceStatus])');
    expect(statements[4]).toContain('([assignedUserId])');
    expect(statements.join('\n')).not.toMatch(
      /\b(UPDATE|INSERT|DROP|TRUNCATE)\b|DELETE FROM/,
    );
    expect(statements.join('\n')).not.toMatch(
      /\[(contactId|remoteJid|connectionId|whatsapp_messages)\]/,
    );
  });
  it('reverts only new schema objects and drops constraints before columns', async () => {
    const query = jest.fn((sql: string) => Promise.resolve(sql));
    await new AddWhatsappConversationAttendance1791540000000().down({
      query,
    } as unknown as QueryRunner);
    expect(query).toHaveBeenCalledTimes(4);
    expect(query.mock.calls[2][0]).toContain(
      'DF_whatsapp_conversations_attendanceStatus',
    );
    expect(query.mock.calls[3][0]).toContain('DROP COLUMN');
    expect(query.mock.calls.map(([sql]) => sql).join('\n')).not.toMatch(
      /DROP TABLE|DELETE FROM/,
    );
  });
});
