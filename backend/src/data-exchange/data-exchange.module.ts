import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Post, Query, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsObject, IsOptional, IsString, IsUUID, MaxLength, validateSync } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { DataSource, EntityManager } from 'typeorm';
import { createHash, randomUUID } from 'node:crypto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AdminGuard } from '../auth/guards/admin.guard';
import type { UserResponse } from '../users/users.service';
import { effectiveRole } from '../users/user-profile';
import { Contact } from '../contacts/entities/contact.entity';
import { ContactType } from '../contact-types/entities/contact-type.entity';
import { Organization } from '../organizations/entities/organization.entity';
import { OrganizationType } from '../organization-types/entities/organization-type.entity';
import { ContactsService } from '../contacts/contacts.service';
import { OrganizationsService } from '../organizations/organizations.service';
import { ContactTypesService } from '../contact-types/contact-types.service';
import { OrganizationTypesService } from '../organization-types/organization-types.service';
import { CreateContactDto } from '../contacts/dto/create-contact.dto';
import { UpdateContactDto } from '../contacts/dto/update-contact.dto';
import { CreateOrganizationDto } from '../organizations/dto/create-organization.dto';
import { CreateContactTypeDto } from '../contact-types/dto/create-contact-type.dto';
import { CreateOrganizationTypeDto } from '../organization-types/dto/create-organization-type.dto';
import { organizationRole } from '../contacts/organization-context';
import { exportRegistrations, ExportFilters } from './registration-export';
import { Catalog, ImportOptions, Operation, RegistrationPlan, RegistrationRow, REGISTRATION_COLUMNS, planRegistrations } from './registration-plan';

export class PreviewImportDto implements ImportOptions {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(10000) @IsObject({ each: true }) rows!: RegistrationRow[];
  @IsOptional() @IsUUID() standaloneOrganizationTypeId?: string;
  @IsOptional() @IsUUID() replacePreviewId?: string;
}
export class ExportRegistrationsDto implements ExportFilters {
  @IsOptional() @IsString() @MaxLength(200) search?: string;
  @IsOptional() @IsIn(['true', 'false', '']) isActive?: string;
  @IsOptional() @IsUUID() organizationId?: string;
}
interface ImportResult { state: 'completed'; summary: RegistrationPlan['summary']; rows: RegistrationPlan['rows']; imported: number; updated: number; existing: number }
interface Session {
  id: string; owner: string; expiresAt: number; input: PreviewImportDto; plan: RegistrationPlan; fingerprint: string;
  state: 'reviewed' | 'committing' | 'completed' | 'uncertain'; result?: ImportResult;
}
const fingerprint = (plan: RegistrationPlan) => createHash('sha256').update(JSON.stringify(plan)).digest('hex');
function validated<T extends object>(Type: new () => T, value: unknown): T {
  const dto = plainToInstance(Type, value);
  const errors = validateSync(dto, { whitelist: true, forbidNonWhitelisted: true });
  if (errors.length) throw new BadRequestException(errors.flatMap(error => Object.values(error.constraints ?? {})).join(' ') || 'Dados de importação inválidos.');
  // Optional class fields must not become undefined writes on sparse contact updates.
  for (const key of Object.keys(dto)) if (Reflect.get(dto, key) === undefined) Reflect.deleteProperty(dto, key);
  return dto;
}

@Injectable()
export class DataExchangeService {
  private sessions = new Map<string, Session>();
  constructor(private readonly source: DataSource) {}
  private own(owner: string, id: string): Session {
    const session = this.sessions.get(id);
    if (!session || session.owner !== owner) throw new NotFoundException('Prévia não encontrada.');
    if (session.expiresAt < Date.now()) {
      if (session.state !== 'committing') this.sessions.delete(id);
      throw new ConflictException('Prévia expirada. Valide o arquivo novamente.');
    }
    return session;
  }
  private async catalog(manager: EntityManager): Promise<Catalog> {
    // Explicit registration projections; no message, history, user or authentication reads.
    // SQL Server transaction requests share one connection and must run sequentially.
    const types = await manager.getRepository(OrganizationType).find({ take: 50001, select: { id: true, name: true, isActive: true } });
    const organizations = await manager.getRepository(Organization).find({ take: 50001, select: { id: true, name: true, organizationTypeId: true, parentOrganizationId: true, isActive: true } });
    const roles = await manager.getRepository(ContactType).find({ take: 50001, select: { id: true, name: true, isActive: true } });
    const contacts = await manager.getRepository(Contact).find({ take: 50001, select: { id: true, organizationId: true, contactTypeId: true, storeName: true, contactName: true, phone: true, email: true, isActive: true } });
    if ([types, organizations, roles, contacts].some(items => items.length > 50000)) throw new BadRequestException('Limite de conferência de 50.000 cadastros atingido. Nenhum resultado parcial foi utilizado.');
    const named = ({ id, name, isActive }: OrganizationType | ContactType) => ({ id, name, isActive });
    return {
      organizationTypes: types.map(named), contactTypes: roles.map(named),
      organizations: organizations.map(({ id, name, isActive, organizationTypeId, parentOrganizationId }) => ({ id, name, isActive, organizationTypeId, parentOrganizationId: parentOrganizationId ?? null })),
      contacts: contacts.map(({ id, organizationId, contactTypeId, storeName, contactName, phone, email, isActive }) => ({ id, organizationId: organizationId ?? null, contactTypeId, storeName: storeName ?? null, contactName, phone, email: email ?? null, isActive })),
    };
  }
  async options() {
    const [types, organizations] = await Promise.all([
      this.source.manager.getRepository(OrganizationType).find({ order: { name: 'ASC' } }),
      this.source.manager.getRepository(Organization).find({ order: { name: 'ASC' } }),
    ]);
    return {
      standaloneTypes: types.filter(type => type.isActive && organizationRole(type.name) === null).map(({ id, name }) => ({ id, name })),
      organizations: organizations.map(({ id, name, isActive, parentOrganizationId }) => ({ id, name, isActive, parentOrganizationId })),
    };
  }
  async export(filters: ExportRegistrationsDto) {
    const catalog = await this.catalog(this.source.manager);
    const result = exportRegistrations(catalog, filters);
    const check = planRegistrations(result.rows, catalog);
    if (check.summary.errorLines) result.warnings.push(`${check.summary.errorLines} linhas contêm ambiguidades ou dados legados que precisarão de revisão antes da reimportação.`);
    return result;
  }
  async preview(owner: string, input: PreviewImportDto) {
    const dto = validated(PreviewImportDto, input);
    for (const row of dto.rows) if (Object.keys(row).some(key => !REGISTRATION_COLUMNS.includes(key as typeof REGISTRATION_COLUMNS[number])) || Object.values(row).some(value => typeof value !== 'string' || value.length > 500))
      throw new BadRequestException('Utilize as oito colunas do modelo Cadastros, preenchidas com textos e números legíveis.');
    for (const [id, session] of this.sessions) if (session.expiresAt < Date.now() && session.state !== 'committing') this.sessions.delete(id);
    const replacement = dto.replacePreviewId ? this.own(owner, dto.replacePreviewId) : undefined;
    if (replacement && replacement.state !== 'reviewed') throw new ConflictException('Esta prévia já foi confirmada ou está em processamento.');
    const retained = [...this.sessions.values()].filter(session => session.id !== replacement?.id);
    if (retained.length >= 100 || retained.filter(session => session.owner === owner).length >= 5 || retained.reduce((total, session) => total + session.input.rows.length, dto.rows.length) > 30000)
      throw new BadRequestException('Limite temporário de prévias atingido. Aguarde 15 minutos ou substitua sua prévia anterior.');
    const plan = planRegistrations(dto.rows, await this.catalog(this.source.manager), dto);
    const session: Session = { id: randomUUID(), owner, expiresAt: Date.now() + 15 * 60 * 1000, input: dto, plan, fingerprint: fingerprint(plan), state: 'reviewed' };
    if (replacement) this.sessions.delete(replacement.id);
    this.sessions.set(session.id, session);
    return { id: session.id, expiresAt: session.expiresAt, rows: plan.rows, summary: plan.summary, canConfirm: plan.summary.errorLines === 0 && plan.rows.some(row => row.action !== 'empty') };
  }
  status(owner: string, id: string) { const session = this.own(owner, id); return { state: session.state, result: session.result }; }
  private async apply(manager: EntityManager, operations: Operation[]) {
    const contacts = new ContactsService(manager.getRepository(Contact), manager.getRepository(ContactType), manager.getRepository(Organization));
    const organizations = new OrganizationsService(manager.getRepository(Organization), manager.getRepository(OrganizationType), manager.getRepository(Contact));
    const contactTypes = new ContactTypesService(manager.getRepository(ContactType), manager.getRepository(Contact));
    const organizationTypes = new OrganizationTypesService(manager.getRepository(OrganizationType), manager.getRepository(Organization));
    const ids = new Map<string, string>();
    const resolveId = (key: string) => {
      if (!key.startsWith('new:')) return key;
      const id = ids.get(key); if (!id) throw new ConflictException('Vínculo previsto não foi resolvido. O lote será revertido.'); return id;
    };
    const ordered = [
      ...operations.filter(op => op.kind === 'organizationType'), ...operations.filter(op => op.kind === 'contactType'),
      ...operations.filter(op => op.kind === 'organization' && op.action === 'update'),
      ...operations.filter(op => op.kind === 'organization' && op.action === 'create'), ...operations.filter(op => op.kind === 'contact'),
    ];
    for (const operation of ordered) {
      const payload = { ...operation.data };
      for (const field of ['organizationTypeId', 'parentOrganizationId', 'organizationId', 'contactTypeId']) if (typeof payload[field] === 'string') payload[field] = resolveId(payload[field] as string);
      if (operation.kind === 'organizationType') ids.set(operation.key, (await organizationTypes.create(validated(CreateOrganizationTypeDto, payload))).id);
      else if (operation.kind === 'contactType') ids.set(operation.key, (await contactTypes.create(validated(CreateContactTypeDto, payload))).id);
      else if (operation.kind === 'organization') {
        if (operation.action === 'create') ids.set(operation.key, (await organizations.create(validated(CreateOrganizationDto, payload))).id);
        else await organizations.updateActive(operation.key, { isActive: Boolean(payload.isActive) });
      } else if (operation.action === 'create') ids.set(operation.key, (await contacts.create(validated(CreateContactDto, payload))).id);
      else await contacts.update(operation.key, validated(UpdateContactDto, payload));
    }
  }
  async commit(actor: Pick<UserResponse, 'id' | 'isAdmin' | 'role'>, id: string): Promise<ImportResult> {
    if (effectiveRole(actor) !== 'administrator') throw new ForbiddenException('Somente administradores podem confirmar importações.');
    const session = this.own(actor.id, id);
    if (session.state === 'completed') return session.result!;
    if (session.state !== 'reviewed') throw new ConflictException('Importação em processamento ou com resultado incerto. Consulte o relatório antes de tentar novamente.');
    if (session.plan.summary.errorLines || !session.plan.rows.some(row => row.action !== 'empty')) throw new BadRequestException('Corrija os erros e conflitos da prévia antes de confirmar. Nenhum cadastro foi alterado.');
    session.state = 'committing';
    let stalePreview = false;
    try {
      const result = await this.source.transaction(async manager => {
        // Fixed lock order; registration tables only. No DDL or WhatsApp data is touched.
        for (const table of ['organizations', 'organization_types', 'contact_types', 'contacts']) await manager.query(`SELECT TOP(1) id FROM dbo.${table} WITH (TABLOCKX,HOLDLOCK)`);
        const plan = planRegistrations(session.input.rows, await this.catalog(manager), session.input);
        if (fingerprint(plan) !== session.fingerprint) {
          stalePreview = true;
          throw new ConflictException({ message: 'Os cadastros mudaram desde a prévia. Valide novamente para revisar as ações atuais. Nenhum cadastro foi alterado.', code: 'IMPORT_PREVIEW_CHANGED' });
        }
        await this.apply(manager, plan.operations);
        return { state: 'completed' as const, summary: plan.summary, rows: plan.rows, imported: plan.operations.filter(op => op.action === 'create').length, updated: plan.operations.filter(op => op.action === 'update').length, existing: plan.summary.existingContacts + plan.summary.existingOrganizations };
      });
      session.result = result; session.state = 'completed'; return result;
    } catch (error) {
      // Do not replay a batch whose SQL COMMIT outcome could be uncertain.
      session.state = stalePreview ? 'reviewed' : 'uncertain'; throw error;
    }
  }
}

@Controller('data-exchange')
export class DataExchangeController {
  constructor(private readonly service: DataExchangeService) {}
  @Get('options') options() { return this.service.options(); }
  @Get('export') export(@Query() filters: ExportRegistrationsDto) { return this.service.export(filters); }
  @Post('preview') preview(@CurrentUser() user: UserResponse, @Body() dto: PreviewImportDto) { return this.service.preview(user.id, dto); }
  @Post('preview-file')
  @UseInterceptors(FileInterceptor('payload', { limits: { fileSize: 8 * 1024 * 1024, files: 1, fields: 0, parts: 2 } }))
  previewFile(@CurrentUser() user: UserResponse, @UploadedFile() file?: { buffer: Buffer }) {
    if (!file?.buffer?.length) throw new BadRequestException('Envie o conteúdo da planilha para revisão.');
    let value: unknown;
    try { value = JSON.parse(file.buffer.toString('utf8')); } catch { throw new BadRequestException('Conteúdo de importação inválido.'); }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BadRequestException('Conteúdo de importação inválido.');
    return this.service.preview(user.id, validated(PreviewImportDto, value));
  }
  @Post(':id/commit') @UseGuards(AdminGuard)
  commit(@CurrentUser() user: UserResponse, @Param('id', new ParseUUIDPipe()) id: string) { return this.service.commit(user, id); }
  @Get(':id') status(@CurrentUser() user: UserResponse, @Param('id', new ParseUUIDPipe()) id: string) { return this.service.status(user.id, id); }
}
@Module({ controllers: [DataExchangeController], providers: [DataExchangeService, AdminGuard] })
export class DataExchangeModule {}
