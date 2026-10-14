import { WhatsappMessageMedia } from './entities/whatsapp-message-media.entity';
import { DataSource, QueryResult, Repository } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { ContactType } from '../contact-types/entities/contact-type.entity';
import { Contact } from '../contacts/entities/contact.entity';
import { OrganizationType } from '../organization-types/entities/organization-type.entity';
import { Organization } from '../organizations/entities/organization.entity';
import { WhatsappConnection } from '../whatsapp-connections/entities/whatsapp-connection.entity';
import { WhatsappConversation } from './entities/whatsapp-conversation.entity';
import { WhatsappMessage } from './entities/whatsapp-message.entity';

jest.mock('@nestjs/typeorm', () => ({
  InjectRepository: () => () => undefined,
}));

import { WhatsappConversationsService } from './whatsapp-conversations.service';

class MetadataDataSource extends DataSource {
  async prepareMetadata(): Promise<void> {
    await this.buildMetadatas();
  }
}

describe('WhatsappConversationsService list pagination (SQL Server)', () => {
  it.each([undefined, 'b0a36315-c991-4c83-bded-e450bbbc3494'])(
    'executes joined pagination and count with connection filter %s',
    async (connectionId) => {
      const source = new MetadataDataSource({
        type: 'mssql',
        entities: [
          WhatsappConversation,
          User,
          Contact,
          ContactType,
          Organization,
          OrganizationType,
        ],
      });
      await source.prepareMetadata();
      const runner = source.createQueryRunner();
      const id = 'bcf2e8e8-9fa4-4e56-a7e0-03f8d59ec170';
      const contactId = '72098c86-0c7a-4af8-9756-6f7745d5e6e6';
      const records = [
        [{ ids_conversation_id: id }],
        [
          {
            conversation_id: id,
            conversation_contactId: contactId,
            conversation_attendanceStatus: 'in_progress',
            conversation_assignedUserId: 'owner-id',
            conversation_attendanceStartedAt: new Date('2026-10-09T10:00:00Z'),
            conversation_attendanceFinishedAt: null,
            assignedUser_id: 'owner-id',
            assignedUser_username: 'atendente',
            conversation_lastMessageAt: new Date('2026-10-09T12:00:00Z'),
            contact_id: contactId,
            contact_contactName: 'Contato cadastrado',
          },
        ],
        [{ cnt: 3 }],
      ];
      const execute = jest.spyOn(runner, 'query').mockImplementation(() => {
        const result = new QueryResult();
        result.records = records.shift() ?? [];
        result.raw = result.records;
        return Promise.resolve(result);
      });
      jest.spyOn(source, 'createQueryRunner').mockReturnValue(runner);
      const service = new WhatsappConversationsService(
        {} as Repository<WhatsappConnection>,
        source.getRepository(WhatsappConversation),
        {} as Repository<WhatsappMessage>,
        {} as Repository<Contact>,
      );

      await expect(
        service.findAll({ connectionId, page: 2, pageSize: 1 }),
      ).resolves.toMatchObject({
        items: [
          {
            id,
            contact: { id: contactId, contactName: 'Contato cadastrado' },
            attendanceStatus: 'in_progress',
            assignedUserId: 'owner-id',
            assignedUser: { id: 'owner-id', username: 'atendente' },
            attendanceStartedAt: new Date('2026-10-09T10:00:00Z'),
            attendanceFinishedAt: null,
          },
        ],
        total: 3,
        page: 2,
        pageSize: 1,
      });

      expect(execute).toHaveBeenCalledTimes(3);
      const sql = execute.mock.calls.map(([statement]) => statement);
      expect(sql[0]).toContain('SELECT DISTINCT');
      expect(sql[0]).toContain('LEFT JOIN "contacts" "contact"');
      expect(sql[0]).toContain('LEFT JOIN "users" "assignedUser"');
      expect(sql[0]).not.toMatch(/passwordHash|isAdmin|canDelete|isActive/);
      expect(source.getRepository(WhatsappConversation).create()).toMatchObject(
        {
          attendanceStatus: 'waiting',
          assignedUserId: null,
        },
      );
      expect(sql[0]).toContain(
        'ORDER BY "distinctAlias"."conversation_lastMessageAt" DESC, "distinctAlias"."conversation_createdAt" DESC, "distinctAlias"."conversation_id" ASC',
      );
      expect(sql[0]).toContain('OFFSET 1 ROWS FETCH NEXT 1 ROWS ONLY');
      expect(sql[1]).toContain(
        'ORDER BY "conversation"."lastMessageAt" DESC, "conversation"."createdAt" DESC, "conversation"."id" ASC',
      );
      expect(sql[2]).toContain('COUNT(DISTINCT("conversation"."id"))');
      expect(sql[2]).not.toContain('OFFSET');
      for (const statement of sql) {
        expect(statement).not.toContain('CASE WHEN');
        expect(statement.includes('"conversation"."connectionId" = @0')).toBe(
          connectionId !== undefined,
        );
      }
      if (connectionId) {
        expect(execute.mock.calls[0][1]?.[0]).toBe(connectionId);
      }
    },
  );
});

describe('Media history SQL Server pagination', () => {
  it('selects public media metadata, hides the internal key and orders before pagination', async () => {
    const previous = process.env.WHATSAPP_MEDIA_ENABLED;
    process.env.WHATSAPP_MEDIA_ENABLED = 'true';
    try {
      const source = new MetadataDataSource({
        type: 'mssql',
        entities: [WhatsappMessage, WhatsappMessageMedia],
      });
      await source.prepareMetadata();
      const runner = source.createQueryRunner();
      const statements: string[] = [];
      jest.spyOn(runner, 'query').mockImplementation((sql: string) => {
        statements.push(sql);
        const result = new QueryResult();
        result.records = sql.includes('COUNT(') ? [{ cnt: 0 }] : [];
        result.raw = result.records;
        return Promise.resolve(result);
      });
      jest.spyOn(source, 'createQueryRunner').mockReturnValue(runner);
      const service = new WhatsappConversationsService(
        {} as Repository<WhatsappConnection>,
        {} as Repository<WhatsappConversation>,
        source.getRepository(WhatsappMessage),
        {} as Repository<Contact>,
      );
      jest
        .spyOn(service, 'findOne')
        .mockResolvedValue({ id: 'conversation' } as WhatsappConversation);
      await service.findMessages('bcf2e8e8-9fa4-4e56-a7e0-03f8d59ec170', {
        page: 2,
        pageSize: 10,
      });
      expect(statements[0]).toContain('LEFT JOIN "whatsapp_message_media"');
      expect(statements[0]).toContain('message_timestamp_missing');
      expect(statements[0]).toContain('OFFSET 10 ROWS FETCH NEXT 10 ROWS ONLY');
      for (const sql of statements) expect(sql).not.toContain('storageKey');
    } finally {
      if (previous === undefined) delete process.env.WHATSAPP_MEDIA_ENABLED;
      else process.env.WHATSAPP_MEDIA_ENABLED = previous;
    }
  });
});
