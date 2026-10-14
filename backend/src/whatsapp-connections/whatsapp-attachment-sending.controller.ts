import {
  Controller,
  Get,
  Post,
  Param,
  ParseUUIDPipe,
  Headers,
  UploadedFile,
  UseInterceptors,
  UseGuards,
  Injectable,
  BadRequestException,
  ServiceUnavailableException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { UserResponse } from '../users/users.service';
import type { AttachmentUpload } from './attachment-validation';
import { WhatsappAttachmentSendingService } from './whatsapp-attachment-sending.service';
import { AUDIO_UPLOAD_MAX_BYTES } from './outbound-audio';

@Injectable()
export class AttachmentUploadGuard implements CanActivate {
  private uploads = 0;
  constructor(private readonly service: WhatsappAttachmentSendingService) {}
  async canActivate(context: ExecutionContext) {
    if (this.uploads >= 2)
      throw new ServiceUnavailableException(
        'Há muitos anexos em envio. Aguarde os envios atuais.',
      );
    const request = context
      .switchToHttp()
      .getRequest<Request & { user: UserResponse }>();
    const id = String(request.params.conversationId);
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        id,
      )
    )
      throw new BadRequestException('Conversa inválida.');
    if (
      typeof request.headers['idempotency-key'] !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        request.headers['idempotency-key'],
      )
    )
      throw new BadRequestException('Chave de envio inválida.');
    this.uploads++;
    let released = false;
    const release = () => {
      if (!released) {
        released = true;
        this.uploads--;
      }
    };
    const response = context.switchToHttp().getResponse<Response>();
    response.once('finish', release);
    response.once('close', release);
    try {
      await this.service.preflight(id, request.user);
    } catch (error) {
      release();
      throw error;
    }
    return true;
  }
}
@Controller('whatsapp-conversations/:conversationId/messages/attachments')
export class WhatsappAttachmentSendingController {
  constructor(private readonly service: WhatsappAttachmentSendingService) {}
  @Post()
  @UseGuards(AttachmentUploadGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      defParamCharset: 'utf8',
      limits: { fileSize: 20 * 1024 * 1024, files: 1, fields: 0, parts: 1 },
    }),
  )
  send(
    @Param('conversationId', new ParseUUIDPipe()) conversationId: string,
    @CurrentUser() user: UserResponse,
    @Headers('idempotency-key') attemptId: string,
    @UploadedFile() file?: AttachmentUpload,
  ) {
    return this.service.send(conversationId, user, attemptId, file);
  }
  @Get('pending')
  pending(
    @Param('conversationId', new ParseUUIDPipe()) conversationId: string,
    @CurrentUser() user: UserResponse,
  ) {
    return this.service.pending(conversationId, user);
  }
  @Get(':attemptId')
  status(
    @Param('conversationId', new ParseUUIDPipe()) conversationId: string,
    @CurrentUser() user: UserResponse,
    @Param('attemptId', new ParseUUIDPipe()) attemptId: string,
  ) {
    return this.service.status(conversationId, user, attemptId);
  }
  @Post(':attemptId/review')
  review(
    @Param('conversationId', new ParseUUIDPipe()) conversationId: string,
    @CurrentUser() user: UserResponse,
    @Param('attemptId', new ParseUUIDPipe()) attemptId: string,
  ) {
    return this.service.review(conversationId, user, attemptId);
  }
}

@Controller('whatsapp-conversations/:conversationId/messages/audio')
export class WhatsappAudioSendingController {
  constructor(private readonly service: WhatsappAttachmentSendingService) {}
  @Post()
  @UseGuards(AttachmentUploadGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      defParamCharset: 'utf8',
      limits: {
        fileSize: AUDIO_UPLOAD_MAX_BYTES,
        files: 1,
        fields: 0,
        parts: 1,
      },
    }),
  )
  send(
    @Param('conversationId', new ParseUUIDPipe()) conversationId: string,
    @CurrentUser() user: UserResponse,
    @Headers('idempotency-key') attemptId: string,
    @UploadedFile() file?: AttachmentUpload,
  ) {
    return this.service.sendAudio(conversationId, user, attemptId, file);
  }
}
