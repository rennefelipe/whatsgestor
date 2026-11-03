import { ConfigService } from '@nestjs/config';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { DataSource, DataSourceOptions } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { OrganizationType } from '../organization-types/entities/organization-type.entity';
import { Organization } from '../organizations/entities/organization.entity';
import { ContactType } from '../contact-types/entities/contact-type.entity';
import { Contact } from '../contacts/entities/contact.entity';
import { ContactDisplaySetting } from '../contact-display-settings/entities/contact-display-setting.entity';
import { ContactCampaignPreference, ContactCampaignPreferenceEvent } from '../contacts/entities/contact-campaign-preference.entity';
import { WhatsappConversation } from '../whatsapp-conversations/entities/whatsapp-conversation.entity';
import { WhatsappMessage } from '../whatsapp-conversations/entities/whatsapp-message.entity';
import { WhatsappMessageMedia } from '../whatsapp-conversations/entities/whatsapp-message-media.entity';
import { recipientSelectionEntities } from '../bulk-send/entities/recipient-selection.entity';

export function createDatabaseOptions(config: ConfigService): TypeOrmModuleOptions {
  return {
    type: 'mssql',
    host: config.getOrThrow<string>('DB_HOST'),
    port: Number(config.getOrThrow('DB_PORT')),
    username: config.getOrThrow<string>('DB_USERNAME'),
    password: config.getOrThrow<string>('DB_PASSWORD'),
    database: config.getOrThrow<string>('DB_DATABASE'),
    synchronize: false,
    migrationsRun: false,
    dropSchema: false,
    logging: false,
    autoLoadEntities: false,
    entities: [User, OrganizationType, Organization, ContactType, Contact,
      ContactDisplaySetting, ContactCampaignPreference, ContactCampaignPreferenceEvent,
      WhatsappConversation, WhatsappMessage, WhatsappMessageMedia,
      ...recipientSelectionEntities],
    retryAttempts: 3,
    retryDelay: 1000,
    connectionTimeout: 10000,
    requestTimeout: 5000,
    pool: { max: 5, min: 0, idleTimeoutMillis: 30000 },
    options: {
      encrypt: config.getOrThrow<boolean>('DB_ENCRYPT'),
      trustServerCertificate: config.getOrThrow<boolean>('DB_TRUST_SERVER_CERTIFICATE'),
      useUTC: true,
    },
  };
}

export async function initializeDataSource(options?: DataSourceOptions): Promise<DataSource> {
  if (!options) throw new Error('Configuracao SQL ausente.');
  const source = new DataSource(options);
  try {
    return await source.initialize();
  } catch {
    // Driver errors can contain usernames or server addresses.
    if (source.isInitialized) await source.destroy().catch(() => undefined);
    throw new Error('SQL_INIT_FAILED: nao foi possivel inicializar a conexao SQL Server.');
  }
}
