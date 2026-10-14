import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { CreateContactTypeDto } from './dto/create-contact-type.dto';
import { UpdateContactTypeActiveDto } from './dto/update-contact-type-active.dto';
import { UpdateContactTypeDto } from './dto/update-contact-type.dto';
import { ContactTypesService } from './contact-types.service';

@Controller('contact-types')
export class ContactTypesController {
  constructor(private readonly service: ContactTypesService) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Get(':id')
  findOne(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateContactTypeDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateContactTypeDto,
  ) {
    return this.service.update(id, dto);
  }

  @Patch(':id/active')
  updateActive(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateContactTypeActiveDto,
  ) {
    return this.service.updateActive(id, dto);
  }

  @Delete(':id')
  remove(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.remove(id);
  }
}
