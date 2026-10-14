import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  Post,
  HttpCode,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AdminGuard } from '../auth/guards/admin.guard';
import type { UserResponse } from '../users/users.service';
import { AssignWhatsappAttendanceDto } from './dto/assign-whatsapp-attendance.dto';
import { WhatsappAttendanceService } from './whatsapp-attendance.service';
import { FindWhatsappConversationsQueryDto } from './dto/find-whatsapp-conversations-query.dto';
import { FindWhatsappMessagesQueryDto } from './dto/find-whatsapp-messages-query.dto';
import { UpdateWhatsappConversationContactDto } from './dto/update-whatsapp-conversation-contact.dto';
import { WhatsappConversationsService } from './whatsapp-conversations.service';

@Controller('whatsapp-conversations')
export class WhatsappConversationsController {
  constructor(
    private readonly conversations: WhatsappConversationsService,
    private readonly attendance: WhatsappAttendanceService,
  ) {}

  @Get()
  findAll(@Query() query: FindWhatsappConversationsQueryDto) {
    return this.conversations.findAll(query);
  }

  @Get(':id/messages')
  findMessages(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: FindWhatsappMessagesQueryDto,
  ) {
    return this.conversations.findMessages(id, query);
  }

  @Get(':id')
  findOne(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.conversations.findOne(id);
  }

  @Post(':id/attendance/claim')
  @HttpCode(200)
  claim(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: UserResponse,
  ) {
    return this.attendance.claim(id, user.id);
  }

  @Post(':id/attendance/finish')
  @HttpCode(200)
  finish(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: UserResponse,
  ) {
    return this.attendance.finish(id, user.id);
  }

  @Post(':id/attendance/reopen')
  @HttpCode(200)
  reopen(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: UserResponse,
  ) {
    return this.attendance.reopen(id, user.id);
  }

  @Patch(':id/attendance/assign')
  @UseGuards(AdminGuard)
  assign(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: UserResponse,
    @Body() dto: AssignWhatsappAttendanceDto,
  ) {
    return this.attendance.assign(id, user.id, dto.assignedUserId);
  }

  @Patch(':id/contact')
  updateContact(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateWhatsappConversationContactDto,
  ) {
    return this.conversations.updateContact(id, dto.contactId);
  }
}
