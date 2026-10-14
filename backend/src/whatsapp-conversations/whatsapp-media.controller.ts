import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  StreamableFile,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { WhatsappMediaService } from './whatsapp-media.service';

// The global AuthGuard verifies JWT and active users, as for conversation/history GETs.
@Controller('whatsapp-conversations/:conversationId/messages/:messageId/media')
export class WhatsappMediaController {
  constructor(private readonly media: WhatsappMediaService) {}
  @Get()
  async file(
    @Param('conversationId', new ParseUUIDPipe()) conversationId: string,
    @Param('messageId', new ParseUUIDPipe()) messageId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const file = await this.media.file(conversationId, messageId);
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; sandbox",
    );
    return new StreamableFile(file.stream, {
      type: file.mimeType,
      length: file.size,
      disposition: `attachment; filename*=UTF-8''${encodeURIComponent(file.name).replace(/'/g, '%27')}`,
    });
  }
}
