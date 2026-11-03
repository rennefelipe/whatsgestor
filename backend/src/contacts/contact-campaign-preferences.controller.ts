import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminGuard } from '../auth/guards/admin.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { UserResponse } from '../users/users.service';
import { ContactCampaignPreferencesService } from './contact-campaign-preferences.service';
import {
  CampaignPreferencePageDto,
  CreateCampaignPreferenceDto,
  RevokeCampaignPreferenceDto,
} from './dto/campaign-preference.dto';

@Controller('contacts')
export class ContactCampaignPreferencesController {
  constructor(
    private readonly preferences: ContactCampaignPreferencesService,
  ) {}
  @Get('campaign-preferences')
  @UseGuards(AdminGuard)
  listAll(
    @Query() page: CampaignPreferencePageDto,
    @CurrentUser() user: UserResponse,
  ) {
    return this.preferences.listAll(page, user);
  }
  @Get(':contactId/campaign-preferences')
  list(
    @Param('contactId', new ParseUUIDPipe()) id: string,
    @Query() page: CampaignPreferencePageDto,
  ) {
    return this.preferences.list(id, page);
  }
  @Post(':contactId/campaign-preferences')
  @UseGuards(AdminGuard)
  create(
    @Param('contactId', new ParseUUIDPipe()) id: string,
    @Body() dto: CreateCampaignPreferenceDto,
    @CurrentUser() user: UserResponse,
  ) {
    return this.preferences.create(id, dto, user);
  }
  @Post('campaign-preferences/:id/revoke')
  @UseGuards(AdminGuard)
  revoke(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: RevokeCampaignPreferenceDto,
    @CurrentUser() user: UserResponse,
  ) {
    return this.preferences.revoke(id, dto, user);
  }
  @Get('campaign-preferences/:id/events')
  events(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() page: CampaignPreferencePageDto,
  ) {
    return this.preferences.events(id, page);
  }
}
