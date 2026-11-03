
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { resolve } from 'node:path';
import { validateEnvironment } from './config/environment';
import { createDatabaseOptions, initializeDataSource } from './config/database';
import { HealthController } from './health/health.controller';
import { AuthModule } from './auth/auth.module';
import { OrganizationTypesModule } from './organization-types/organization-types.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { ContactTypesModule } from './contact-types/contact-types.module';
import { ContactDisplaySettingsModule } from './contact-display-settings/contact-display-settings.module';
import { ContactsModule } from './contacts/contacts.module';
import { WhatsappConversationsModule } from './whatsapp-conversations/whatsapp-conversations.module';
import { MessagesModule } from './messages/messages.module';
import { WhatsappIntegrationModule } from './whatsapp-integration/whatsapp-integration.module';
import { BulkSendModule } from './bulk-send/bulk-send.module';
import { AutomaticMessagesModule } from './automatic-messages/automatic-messages.module';
import { DataExchangeModule } from './data-exchange/data-exchange.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: resolve(__dirname, '..', '.env'),
      validate: validateEnvironment,
    }),

    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => createDatabaseOptions(config),
      dataSourceFactory: initializeDataSource,
    }),
    AuthModule,
    OrganizationTypesModule,
    OrganizationsModule,
    ContactTypesModule,
    ContactDisplaySettingsModule,
    ContactsModule,
    WhatsappConversationsModule,
    MessagesModule,
    WhatsappIntegrationModule,
    BulkSendModule,
    AutomaticMessagesModule,
    DataExchangeModule,
  ],
  controllers: [AppController, HealthController],
})
export class AppModule {}
