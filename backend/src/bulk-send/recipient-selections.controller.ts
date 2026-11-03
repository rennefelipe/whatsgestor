import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { UserResponse } from '../users/users.service';
import {
  CreateRecipientSelectionDto,
  RecipientPageDto,
  UpdateRecipientSelectionDto,
} from './recipient-selection.dto';
import { RecipientSelectionsService } from './recipient-selections.service';

@Controller('bulk-send/recipient-selections')
export class RecipientSelectionsController {
  constructor(private readonly selections: RecipientSelectionsService) {}
  @Post()
  create(
    @CurrentUser() user: UserResponse,
    @Body() dto: CreateRecipientSelectionDto,
  ) {
    return this.selections.create(user.id, dto.filters, dto.requestId);
  }
  @Get('latest')
  latest(@CurrentUser() user: UserResponse) {
    return this.selections.latest(user.id);
  }
  @Get()
  list(@CurrentUser() user: UserResponse, @Query() page: RecipientPageDto) {
    return this.selections.list(user.id, page);
  }
  @Get('operations/:requestId')
  operation(
    @CurrentUser() user: UserResponse,
    @Param('requestId', new ParseUUIDPipe()) requestId: string,
  ) {
    return this.selections.operation(user.id, requestId);
  }
  @Post('operations/:id/recover')
  recover(
    @CurrentUser() user: UserResponse,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.selections.recover(user.id, id);
  }
  @Get(':id/revisions')
  revisions(
    @CurrentUser() user: UserResponse,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() page: RecipientPageDto,
  ) {
    return this.selections.revisions(user.id, id, page);
  }
  @Get(':id/revisions/:revisionId')
  historical(
    @CurrentUser() user: UserResponse,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('revisionId', new ParseUUIDPipe()) revisionId: string,
    @Query() page: RecipientPageDto,
  ) {
    return this.selections.historical(user.id, id, revisionId, page);
  }
  @Get(':id/revisions/:revisionId/sources/:key')
  sources(
    @CurrentUser() user: UserResponse,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('revisionId', new ParseUUIDPipe()) revisionId: string,
    @Param('key') key: string,
    @Query() page: RecipientPageDto,
  ) {
    return this.selections.sources(user.id, id, revisionId, key, page);
  }
  @Get(':id')
  get(
    @CurrentUser() user: UserResponse,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() page: RecipientPageDto,
  ) {
    return this.selections.get(user.id, id, page);
  }
  @Patch(':id')
  update(
    @CurrentUser() user: UserResponse,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateRecipientSelectionDto,
  ) {
    return this.selections.update(user.id, id, dto);
  }
}
