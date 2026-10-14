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
import { WhatsappSessionManagerService } from './baileys/whatsapp-session-manager.service';
import { CreateWhatsappConnectionDto } from './dto/create-whatsapp-connection.dto';
import { UpdateWhatsappConnectionActiveDto } from './dto/update-whatsapp-connection-active.dto';
import { UpdateWhatsappConnectionDto } from './dto/update-whatsapp-connection.dto';
import { WhatsappConnectionsService } from './whatsapp-connections.service';

@Controller('whatsapp-connections')
export class WhatsappConnectionsController {
  constructor(
    private readonly connections: WhatsappConnectionsService,
    private readonly sessions: WhatsappSessionManagerService,
  ) {}

  @Get()
  findAll() {
    return this.connections.findAll();
  }

  @Get(':id')
  findOne(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.connections.findOne(id);
  }

  @Post(':id/connect')
  @UseGuards(AdminGuard)
  connect(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.sessions.connect(id);
  }

  @Get(':id/qr')
  @UseGuards(AdminGuard)
  getQr(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.sessions.getQr(id);
  }

  @Get(':id/status')
  getStatus(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.sessions.getStatus(id);
  }

  @Post(':id/disconnect')
  @UseGuards(AdminGuard)
  disconnect(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.sessions.disconnect(id);
  }

  @Post(':id/logout')
  @UseGuards(AdminGuard)
  logout(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.sessions.logout(id);
  }

  @Post()
  create(@Body() dto: CreateWhatsappConnectionDto) {
    return this.connections.create(dto);
  }

  @Patch(':id')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateWhatsappConnectionDto,
  ) {
    return this.connections.update(id, dto);
  }

  @Patch(':id/active')
  updateActive(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateWhatsappConnectionActiveDto,
  ) {
    return this.connections.updateActive(id, dto);
  }
}
