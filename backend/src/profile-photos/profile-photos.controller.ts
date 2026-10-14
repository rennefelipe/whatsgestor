import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  ProfilePhotosService,
  type ProfilePhoto,
} from './profile-photos.service';

// The existing global AuthGuard checks JWT and active user; no public photo URLs.
@Controller('whatsapp-profile-photos')
export class ProfilePhotosController {
  constructor(private readonly photos: ProfilePhotosService) {}
  private reply(photo: ProfilePhoto | null, response: Response) {
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    if (!photo) {
      response.status(204);
      return;
    }
    return new StreamableFile(photo.bytes, {
      type: photo.mime,
      length: photo.bytes.length,
    });
  }
  @Get('conversations/:id')
  async conversation(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.reply(await this.photos.conversation(id), response);
  }
  @Get('contacts/:id')
  async contact(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.reply(await this.photos.contact(id), response);
  }
}
