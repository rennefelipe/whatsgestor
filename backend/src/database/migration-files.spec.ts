import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DataSource } from 'typeorm';
import { migrationFiles } from './migration-files';

class MetadataDataSource extends DataSource {
  async prepareMetadata(): Promise<void> {
    await this.buildMetadatas();
  }
}

describe('migrationFiles', () => {
  it('loads real migrations and excludes TypeScript and compiled test files', async () => {
    const directory = mkdtempSync(join(__dirname, 'migration-fixtures-'));
    try {
      writeFileSync(
        join(directory, '1791493160976-LinkWhatsappConversationsToContacts.js'),
        'exports.LinkWhatsappConversationsToContacts1791493160976 = class LinkWhatsappConversationsToContacts1791493160976 {};',
      );
      for (const extension of ['ts', 'js']) {
        for (const suffix of ['spec', 'test']) {
          writeFileSync(
            join(
              directory,
              `1791493160976-LinkWhatsappConversationsToContacts.${suffix}.${extension}`,
            ),
            'throw new Error("A test file was loaded as a migration");',
          );
        }
      }
      writeFileSync(
        join(directory, 'helper.js'),
        'throw new Error("A non-migration file was loaded");',
      );
      const source = new MetadataDataSource({
        type: 'mssql',
        entities: [],
        migrations: [migrationFiles(directory)],
      });
      await source.prepareMetadata();

      expect(
        source.migrations.map((migration) => migration.constructor.name),
      ).toEqual(['LinkWhatsappConversationsToContacts1791493160976']);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
