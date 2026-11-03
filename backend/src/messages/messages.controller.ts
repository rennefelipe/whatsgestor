import { BadRequestException, Body, CanActivate, Controller, ExecutionContext, Get, HttpCode, Injectable, Param, ParseUUIDPipe,
  Post, Query, Req, Res, ServiceUnavailableException, StreamableFile, UnsupportedMediaTypeException, UploadedFile, UseGuards, UseInterceptors, Header, Headers } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IsString, MaxLength, isUUID } from 'class-validator';
import { FilePolicy, canonicalMime, type FileKind } from './file-policy';
import { MessagesService } from './messages.service';
import { MessageFilesService } from './message-files.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { UserResponse } from '../users/users.service';
import { TextDecoder } from 'node:util';
import { OutboundRouter } from './outbound-router';

class PrepareTextDto {
  @IsString() @MaxLength(65536) textContent!: string;
}
@Injectable()
export class SendEnabledGuard implements CanActivate {
  constructor(private readonly router:OutboundRouter){}
  async canActivate(context:ExecutionContext){await this.router.requireAvailable(context.switchToHttp().getRequest().params.conversationId);return true;}
}
@Injectable()
export class FileUploadGuard implements CanActivate {
  private active = 0;
  constructor(private readonly policy: FilePolicy, private readonly messages: MessagesService) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    if (!isUUID(request.params.conversationId)) throw new BadRequestException('Conversa invalida.');
    // Authorize before Multer allocates memory for any file bytes.
    await this.messages.authorizePreparation(request.params.conversationId, request.user);
    if (this.active >= this.policy.concurrency) throw new ServiceUnavailableException('Limite de preparacao de arquivos atingido.');
    this.active++;
    let released = false;
    const response = context.switchToHttp().getResponse();
    const timer = setTimeout(() => { context.switchToHttp().getRequest().destroy(); }, this.policy.uploadTimeoutMs);
    timer.unref();
    const release = () => { if (!released) { released = true; this.active--; clearTimeout(timer); } };
    response.once('finish', release); response.once('close', release);
    return true;
  }
}

interface Upload { buffer: Buffer; originalname: string; mimetype: string; size: number }
interface HttpResponse {
  setHeader(name: string, value: string | number): void;
  status(code: number): unknown;
  once(event: string, fn: () => void): unknown;
}

export function byteRange(value: string | undefined, size: number): { start: number; end: number } | null {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2]) || size === 0) throw new BadRequestException('Intervalo invalido.');
  if ([match[1], match[2]].some((part) => part && !Number.isSafeInteger(Number(part)))) throw new BadRequestException('Intervalo invalido.');
  let start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  let end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start || (!match[1] && Number(match[2]) === 0)) throw new BadRequestException('Intervalo invalido.');
  return { start, end };
}

@Controller('whatsapp-conversations/:conversationId/messages')
export class MessagesController {
  constructor(private readonly messages: MessagesService, private readonly files: MessageFilesService, private readonly policy: FilePolicy,private readonly outbound:OutboundRouter) {}
  @Get('capabilities') @Header('Cache-Control', 'private, no-store')
  capabilities(@Param('conversationId', new ParseUUIDPipe()) id: string) { return this.messages.capabilities(id); }

  @Post('prepare') @HttpCode(200) @Header('Cache-Control', 'private, no-store')
  prepare(@Param('conversationId', new ParseUUIDPipe()) id: string, @Body() dto: PrepareTextDto, @CurrentUser() user: UserResponse) {
    return this.messages.prepareText(id, dto.textContent, user);
  }
  @Post('attachments/prepare') @HttpCode(200) @Header('Cache-Control', 'private, no-store') @UseGuards(FileUploadGuard) @UseInterceptors(FileInterceptor('file'))
  prepareFile(@Param('conversationId', new ParseUUIDPipe()) id: string, @UploadedFile() file: Upload, @CurrentUser() user: UserResponse) {
    if (!file || !Buffer.isBuffer(file.buffer)) throw new BadRequestException('Arquivo obrigatorio.');
    const mime = canonicalMime(file.mimetype);
    const format = this.policy.capabilities().formats[mime];
    if (!format) throw new UnsupportedMediaTypeException('Tipo de arquivo nao suportado.');
    let name = file.originalname;
    // Multer's installed Busboy uses latin1 for unencoded filename parameters.
    // Decode only a valid UTF-8 byte sequence; preserve genuine latin1 names.
    if ([...name].every((c) => c.charCodeAt(0) <= 255)) {
      try { name = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(name, 'latin1')); } catch { /* original name retained */ }
    }
    return this.messages.prepareFile(id, file.buffer, { kind: format.kind as FileKind, mimeType: file.mimetype, originalName: name }, user);
  }
  @Post() async send(@Param('conversationId', new ParseUUIDPipe()) id: string,@Body() body:unknown,@Headers('idempotency-key')key:string,@CurrentUser()user:UserResponse) {
    await this.messages.capabilities(id);await this.outbound.requireAvailable(id);
    if(!body||typeof body!=='object'||Object.keys(body).some(k=>k!=='textContent'))throw new BadRequestException('Mensagem invalida.');
    return this.outbound.send({conversationId:id,key,actor:user,text:(body as {textContent?:unknown}).textContent});
  }
  @Post('attachments') @UseGuards(SendEnabledGuard,FileUploadGuard) @UseInterceptors(FileInterceptor('file'))
  sendFile(@Param('conversationId', new ParseUUIDPipe()) id: string,@UploadedFile()file:Upload,@Headers('idempotency-key')key:string,@CurrentUser()user:UserResponse) {
    return this.dispatchFile(id,file,key,user,false);
  }
  @Post('audio') @UseGuards(SendEnabledGuard,FileUploadGuard) @UseInterceptors(FileInterceptor('file'))
  sendAudio(@Param('conversationId', new ParseUUIDPipe()) id: string,@UploadedFile()file:Upload,@Headers('idempotency-key')key:string,@CurrentUser()user:UserResponse) {
    return this.dispatchFile(id,file,key,user,true);
  }
  private dispatchFile(id:string,file:Upload,key:string,user:UserResponse,audioOnly:boolean){
    if(!file||!Buffer.isBuffer(file.buffer))throw new BadRequestException('Arquivo obrigatorio.');
    const format=this.policy.capabilities().formats[canonicalMime(file.mimetype)];
    if(!format||audioOnly&&format.kind!=='audio')throw new UnsupportedMediaTypeException('Arquivo nao suportado.');
    let name=file.originalname;
    if([...name].every(c=>c.charCodeAt(0)<=255))try{name=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.from(name,'latin1'));}catch{}
    return this.outbound.send({conversationId:id,key,actor:user,file:{content:file.buffer,metadata:{kind:format.kind as FileKind,mimeType:file.mimetype,originalName:name}}});
  }
  @Get('attachments/pending') @Header('Cache-Control','private, no-store') pending(@Param('conversationId', new ParseUUIDPipe()) id: string,@CurrentUser()user:UserResponse) { return this.outbound.pending(id,user); }
  @Get('attachments/:attemptId') @Header('Cache-Control','private, no-store') attempt(@Param('conversationId', new ParseUUIDPipe()) id: string, @Param('attemptId', new ParseUUIDPipe()) attempt: string,@CurrentUser()user:UserResponse) { return this.outbound.attempt(id,attempt,user); }
  @Post('attachments/:attemptId/review') review(@Param('conversationId', new ParseUUIDPipe()) id: string, @Param('attemptId', new ParseUUIDPipe()) attempt: string,@CurrentUser()user:UserResponse) { return this.outbound.review(id,attempt,user); }

  @Get(':messageId/media/metadata') @Header('Cache-Control', 'private, no-store')
  metadata(@Param('conversationId', new ParseUUIDPipe()) conversationId: string, @Param('messageId', new ParseUUIDPipe()) messageId: string) {
    return this.files.metadata(conversationId, messageId);
  }
  @Get(':messageId/media')
  async file(@Param('conversationId', new ParseUUIDPipe()) conversationId: string, @Param('messageId', new ParseUUIDPipe()) messageId: string,
    @Req() request: { headers: { range?: string } }, @Res({ passthrough: true }) response: HttpResponse,
    @Query('disposition') disposition?: string) {
    if (disposition !== undefined && !['inline', 'attachment'].includes(disposition)) throw new BadRequestException('Disposicao invalida.');
    const file = await this.files.file(conversationId, messageId);
    let range;
    try { range = byteRange(request.headers.range, file.size); }
    catch {
      await file.handle.close(); response.setHeader('Content-Range', `bytes */${file.size}`);
      const { HttpException } = await import('@nestjs/common');
      throw new HttpException('Intervalo indisponivel.', 416);
    }
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    response.setHeader('Accept-Ranges', 'bytes');
    if (range) { response.status(206); response.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${file.size}`); }
    const safeInline = /^(image\/(jpeg|png|webp|gif)|audio\/(ogg|mpeg|wav|mp4|aac)|video\/(mp4|webm)|application\/pdf)$/.test(file.mimeType);
    const mode = disposition === 'inline' && safeInline ? 'inline' : 'attachment';
    const stream = file.handle.createReadStream(range ?? {});
    response.once('close', () => stream.destroy());
    return new StreamableFile(stream, { type: file.mimeType, length: range ? range.end - range.start + 1 : file.size,
      disposition: `${mode}; filename*=UTF-8''${encodeURIComponent(file.name).replace(/['()*]/g, (c) => '%' + c.charCodeAt(0).toString(16))}` });
  }
}
