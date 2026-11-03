import { Body, Controller, Delete, Get, Global, Injectable, Module, OnModuleDestroy, OnModuleInit, Param, ParseUUIDPipe, Post, Put, UseGuards, BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IsBoolean, IsIn, IsInt, IsString, MaxLength, Min, MinLength } from 'class-validator';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { AdminGuard } from '../auth/guards/admin.guard';
import { DomainEvent, DomainEvents, DomainEventsModule } from '../events/domain-events';

export const AUTOMATIC_EVENTS = ['waiting', 'started', 'transferred', 'finished'] as const;
export type AutomaticEvent = typeof AUTOMATIC_EVENTS[number];
export interface AutomaticTemplate { id: string; name: string; event: AutomaticEvent; text: string; isActive: boolean; version: number }
export class TemplateDto {
  @IsString() @MinLength(1) @MaxLength(100) name!: string;
  @IsIn(AUTOMATIC_EVENTS) event!: AutomaticEvent;
  @IsString() @MinLength(1) @MaxLength(2000) text!: string;
  @IsBoolean() isActive!: boolean;
  @IsInt() @Min(0) version!: number;
}
const defaults: Array<[AutomaticEvent, string, string]> = [
  ['waiting', 'Aguardando atendimento', 'Olá! Recebemos sua mensagem. Aguarde, em breve um atendente irá responder.'],
  ['started', 'Atendimento iniciado', 'Seu atendimento foi iniciado por {atendente}.'],
  ['transferred', 'Atendimento transferido', 'Seu atendimento foi transferido para {atendente}.'],
  ['finished', 'Atendimento finalizado', 'Seu atendimento foi finalizado. Agradecemos o contato!'],
];
export function renderTemplate(text: string, agent: string): string {
  if (/\{[^{}]*\}/g.test(text.replaceAll('{atendente}', '')) || /[{}]/.test(text.replaceAll('{atendente}', '')))
    throw new BadRequestException('Variável não reconhecida. Utilize {atendente}.');
  return text.replaceAll('{atendente}', () => agent);
}

/** Deliberately has no outbound provider. Real dispatch requires a separate approved implementation. */
@Injectable()
export class AutomaticMessagesService implements OnModuleInit, OnModuleDestroy {
  private tail: Promise<unknown> = Promise.resolve();
  private unsubscribe?: () => void;
  private observed = new Map<string, { event: AutomaticEvent; at: string; matched: number }>();
  private templates: AutomaticTemplate[] | null = null;
  private readonly path: string;
  constructor(config: ConfigService, private readonly events: DomainEvents) {
    this.path = resolve(config.get<string>('APP_SETTINGS_DIRECTORY') || resolve(__dirname, '..', '..', 'data', 'application-settings'), 'automatic-messages.json');
  }
  onModuleInit() { this.unsubscribe = this.events.subscribe(event => this.observe(event)); }
  onModuleDestroy() { this.unsubscribe?.(); }
  private observe(event: DomainEvent) {
    if (event.type !== 'attendance.changed' || !event.automaticEvent || !event.transitionKey) return;
    if (this.observed.has(event.transitionKey)) return;
    this.observed.set(event.transitionKey, { event: event.automaticEvent, at: event.at, matched: this.templates?.filter(template => template.isActive && template.event === event.automaticEvent).length ?? 0 });
    if (this.observed.size > 200) this.observed.delete(this.observed.keys().next().value!);
  }
  private async read(): Promise<AutomaticTemplate[]> {
    if (this.templates) return this.templates;
    try {
      const value: unknown = JSON.parse(await readFile(this.path, 'utf8'));
      if (!Array.isArray(value) || value.length > 100 || value.some(item => !item || typeof item.id !== 'string' || typeof item.name !== 'string' || typeof item.text !== 'string' || typeof item.isActive !== 'boolean' || !AUTOMATIC_EVENTS.includes(item.event) || !Number.isInteger(item.version))) throw new Error('Invalid templates file');
      this.templates = value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      this.templates = defaults.map(([event, name, text]) => ({ id: randomUUID(), event, name, text, isActive: false, version: 1 }));
    }
    return this.templates!;
  }
  async list() { return { templates: await this.read(), dispatchEnabled: false as const, mode: 'preview-only', recentEvents: [...this.observed.values()].reverse() }; }
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.tail.catch(() => undefined).then(work); this.tail = next; return next;
  }
  private async persist(templates: AutomaticTemplate[]) {
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(templates, null, 2), { encoding: 'utf8', mode: 0o600 });
    await rename(temporary, this.path);
    this.templates = templates;
  }
  save(dto: TemplateDto, id?: string) {
    return this.serial(async () => {
      renderTemplate(dto.text, 'Atendente');
      if (!dto.name.trim() || !dto.text.trim()) throw new BadRequestException('Informe nome e texto.');
      const templates = await this.read();
      const existing = id ? templates.find(item => item.id === id) : undefined;
      if (id && !existing) throw new NotFoundException('Modelo não encontrado.');
      if (existing && existing.version !== dto.version) throw new ConflictException('Modelo alterado por outro usuário. Atualize a página.');
      if (!id && templates.length >= 100) throw new BadRequestException('Limite de 100 modelos.');
      if (dto.isActive && templates.some(item => item.id !== id && item.event === dto.event && item.isActive)) throw new ConflictException('Desative o outro modelo deste evento antes de ativar este.');
      const template: AutomaticTemplate = { id: existing?.id ?? randomUUID(), name: dto.name.trim(), text: dto.text.trim(), event: dto.event, isActive: dto.isActive, version: (existing?.version ?? 0) + 1 };
      await this.persist(existing ? templates.map(item => item.id === id ? template : item) : [...templates, template]);
      return template;
    });
  }
  remove(id: string, version: number) {
    return this.serial(async () => {
      const templates = await this.read(), template = templates.find(item => item.id === id);
      if (!template) throw new NotFoundException('Modelo não encontrado.');
      if (template.isActive) throw new ConflictException('Desative o modelo antes de excluir.');
      if (template.version !== version) throw new ConflictException('Modelo alterado. Atualize a página.');
      await this.persist(templates.filter(item => item.id !== id));
      return { deleted: true };
    });
  }
}
class DeleteTemplateDto { @IsInt() @Min(1) version!: number }
@Controller('automatic-messages')
@UseGuards(AdminGuard)
export class AutomaticMessagesController {
  constructor(private readonly service: AutomaticMessagesService) {}
  @Get() list() { return this.service.list(); }
  @Post() create(@Body() dto: TemplateDto) { return this.service.save(dto); }
  @Put(':id') update(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: TemplateDto) { return this.service.save(dto, id); }
  @Delete(':id') remove(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: DeleteTemplateDto) { return this.service.remove(id, dto.version); }
}
@Global()
@Module({ imports: [DomainEventsModule], controllers: [AutomaticMessagesController], providers: [AutomaticMessagesService, AdminGuard], exports: [AutomaticMessagesService] })
export class AutomaticMessagesModule {}
