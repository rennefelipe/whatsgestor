import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
} from '@nestjs/common';
import { UpdateContactDisplaySettingDto } from './dto/update-contact-display-setting.dto';
import { ContactDisplaySettingsService } from './contact-display-settings.service';

@Controller('contact-display-settings')
export class ContactDisplaySettingsController {
  constructor(private readonly service: ContactDisplaySettingsService) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Patch(':id')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateContactDisplaySettingDto,
  ) {
    return this.service.update(id, dto);
  }
}
