import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ContactDisplaySettingsController } from './contact-display-settings.controller';
import { ContactDisplaySettingsService } from './contact-display-settings.service';
import { ContactDisplaySetting } from './entities/contact-display-setting.entity';

@Module({
  imports: [TypeOrmModule.forFeature([ContactDisplaySetting])],
  controllers: [ContactDisplaySettingsController],
  providers: [ContactDisplaySettingsService],
})
export class ContactDisplaySettingsModule {}
