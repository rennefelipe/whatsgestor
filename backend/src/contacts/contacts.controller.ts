import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CreateContactDto } from './dto/create-contact.dto';
import { FindContactsQueryDto } from './dto/find-contacts-query.dto';
import { UpdateContactActiveDto } from './dto/update-contact-active.dto';
import { UpdateContactDto } from './dto/update-contact.dto';
import { ContactsService } from './contacts.service';

@Controller('contacts')
export class ContactsController {
  constructor(private readonly service: ContactsService) {}

  @Get()
  findAll(@Query() query: FindContactsQueryDto) {
    return this.service.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateContactDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateContactDto,
  ) {
    return this.service.update(id, dto);
  }

  @Patch(':id/active')
  updateActive(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateContactActiveDto,
  ) {
    return this.service.updateActive(id, dto);
  }

  @Delete(':id')
  remove(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.remove(id);
  }
}
