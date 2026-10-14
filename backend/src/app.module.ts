import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule, TypeOrmModuleOptions } from '@nestjs/typeorm';
import { join } from 'node:path';
import { AuthModule } from './auth/auth.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ContactDisplaySettingsModule } from './contact-display-settings/contact-display-settings.module';
import { ContactsModule } from './contacts/contacts.module';
import { ContactTypesModule } from './contact-types/contact-types.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { OrganizationTypesModule } from './organization-types/organization-types.module';
import { UsersModule } from './users/users.module';
import { WhatsappConnectionsModule } from './whatsapp-connections/whatsapp-connections.module';
import { WhatsappConversationsModule } from './whatsapp-conversations/whatsapp-conversations.module';
import { migrationFiles } from './database/migration-files';
import { ProfilePhotosModule } from './profile-photos/profile-photos.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    OrganizationTypesModule,
    OrganizationsModule,
    ContactTypesModule,
    ContactsModule,
    ContactDisplaySettingsModule,
    UsersModule,
    WhatsappConnectionsModule,
    WhatsappConversationsModule,
    ProfilePhotosModule,
    AuthModule,
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService): TypeOrmModuleOptions => ({
        type: 'mssql',
        host: configService.getOrThrow<string>('DB_HOST'),
        port: Number(configService.getOrThrow<string>('DB_PORT')),
        username: configService.getOrThrow<string>('DB_USERNAME'),
        password: configService.getOrThrow<string>('DB_PASSWORD'),
        database: configService.getOrThrow<string>('DB_DATABASE'),
        autoLoadEntities: true,
        synchronize: false,
        options: {
          encrypt: false,
          trustServerCertificate: true,
          // Attendance uses SYSUTCDATETIME; message parameters must use UTC too.
          useUTC: true,
        },
        migrations: [migrationFiles(join(__dirname, 'database', 'migrations'))],
      }),
    }),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
