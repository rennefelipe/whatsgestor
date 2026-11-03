import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AdminGuard } from '../auth/guards/admin.guard';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserActiveDto } from './dto/update-user-active.dto';
import { UpdateUserDeletePermissionDto } from './dto/update-user-delete-permission.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UsersService } from './users.service';

@Controller('users')
@UseGuards(AdminGuard)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  findAll() {
    return this.users.findAll();
  }

  @Get('schema')
  schemaStatus() {
    return this.users.schemaStatus();
  }

  @Get(':id')
  findOne(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.users.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateUserDto) {
    return this.users.create(dto);
  }

  @Patch(':id')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateUserDto,
  ) {
    return this.users.update(id, dto);
  }

  @Patch(':id/active')
  updateActive(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateUserActiveDto,
  ) {
    return this.users.updateActive(id, dto);
  }

  @Patch(':id/delete-permission')
  updateDeletePermission(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateUserDeletePermissionDto,
  ) {
    return this.users.updateDeletePermission(id, dto);
  }
}
