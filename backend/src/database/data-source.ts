import { WhatsappMessageMedia } from '../whatsapp-conversations/entities/whatsapp-message-media.entity';
import { WhatsappMessage } from '../whatsapp-conversations/entities/whatsapp-message.entity';
import { WhatsappConversation } from '../whatsapp-conversations/entities/whatsapp-conversation.entity';
import 'dotenv/config';
import { join } from 'node:path';
import { DataSource } from 'typeorm';
import { Organization } from '../organizations/entities/organization.entity';
import { OrganizationType } from '../organization-types/entities/organization-type.entity';
import { Contact } from '../contacts/entities/contact.entity';
import { ContactType } from '../contact-types/entities/contact-type.entity';
import { User } from '../users/entities/user.entity';
import { ContactDisplaySetting } from '../contact-display-settings/entities/contact-display-setting.entity';
import { WhatsappConnection } from '../whatsapp-connections/entities/whatsapp-connection.entity';
import { migrationFiles } from './migration-files';

function requiredEnvironmentVariable(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const port = Number(requiredEnvironmentVariable('DB_PORT'));
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('DB_PORT must be a valid TCP port number');
}

export default new DataSource({
  type: 'mssql',
  host: requiredEnvironmentVariable('DB_HOST'),
  port,
  username: requiredEnvironmentVariable('DB_USERNAME'),
  password: requiredEnvironmentVariable('DB_PASSWORD'),
  database: requiredEnvironmentVariable('DB_DATABASE'),
  synchronize: false,
  options: {
    encrypt: false,
    trustServerCertificate: true,
    // Attendance uses SYSUTCDATETIME; message parameters must use UTC too.
    useUTC: true,
  },
  entities: [
    OrganizationType,
    Organization,
    ContactType,
    Contact,
    User,
    ContactDisplaySetting,
    WhatsappConnection,
    WhatsappConversation,
    WhatsappMessage,
    WhatsappMessageMedia,
  ],
  migrations: [migrationFiles(join(__dirname, 'migrations'))],
});
