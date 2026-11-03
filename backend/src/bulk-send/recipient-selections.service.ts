import {
  BadRequestException,
  HttpException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { FindContactsQueryDto } from '../contacts/dto/find-contacts-query.dto';
import { RecipientCatalogService } from './recipient-catalog.service';
import {
  RecipientPageDto,
  UpdateRecipientSelectionDto,
} from './recipient-selection.dto';
import {
  RecipientSelectionEngine,
  Selection,
} from './recipient-selection-engine';
import { SelectionStore, OperationInput } from './recipient-selection-store';
import {
  RecipientSelection as Header,
  RecipientSelectionOperation as Operation,
} from './entities/recipient-selection.entity';

@Injectable()
export class RecipientSelectionsService {
  private readonly engine: RecipientSelectionEngine;
  private readonly logger = new Logger(RecipientSelectionsService.name);
  private processing = 0;
  constructor(
    private readonly catalog: RecipientCatalogService,
    private readonly store: SelectionStore,
  ) {
    this.engine = new RecipientSelectionEngine(catalog);
  }
  private blank(header: Header, filters: FindContactsQueryDto = {}): Selection {
    return {
      id: header.id,
      ownerId: header.ownerId,
      version: header.version,
      expiresAt: header.expiresAt?.getTime() ?? null,
      filters,
      catalog: { rows: [], recordsFound: 0, preferencesStatus: 'available' },
      selected: new Map(),
    };
  }
  private operationView(operation: Operation | null) {
    if (!operation) return null;
    return {
      id: operation.id,
      requestId: operation.requestId,
      selectionId: operation.selectionId,
      status: operation.status,
      processed: operation.processed,
      total: operation.total,
      attempt: operation.attempt,
      leaseExpiresAt: operation.leaseExpiresAt.toISOString(),
      recoverable:
        operation.status === 'failed' ||
        (operation.status === 'building' &&
          operation.leaseExpiresAt.getTime() <= Date.now()),
      errors: JSON.parse(operation.errors) as Array<{
        at: string;
        message: string;
      }>,
    };
  }
  async create(
    ownerId: string,
    filters: FindContactsQueryDto,
    requestId: string = randomUUID(),
  ) {
    return this.start(ownerId, null, requestId, 0, {
      action: 'create',
      filters,
    });
  }
  async update(ownerId: string, id: string, dto: UpdateRecipientSelectionDto) {
    return this.start(ownerId, id, dto.requestId ?? randomUUID(), dto.version, {
      action: dto.action,
      ...(dto.filters ? { filters: dto.filters } : {}),
      ...(dto.key ? { key: dto.key } : {}),
    });
  }
  private async start(
    ownerId: string,
    id: string | null,
    requestId: string,
    version: number,
    input: OperationInput,
  ) {
    if (this.processing >= 2)
      throw new ServiceUnavailableException(
        'Limite local de processamento atingido. Tente novamente; nenhuma revisão foi substituída.',
      );
    const claim = await this.store.begin(
      ownerId,
      id,
      requestId,
      version,
      input,
    );
    if (claim.run) await this.execute(claim.operation);
    return this.get(
      ownerId,
      claim.operation.selectionId,
      new RecipientPageDto(),
    );
  }
  private async execute(operation: Operation) {
    if (this.processing >= 2) {
      await this.store.fail(
        operation,
        'Limite local de processamento atingido; a revisão anterior foi preservada.',
      );
      throw new ServiceUnavailableException(
        'Limite local de processamento atingido. Recupere a operação após a conclusão das demais.',
      );
    }
    this.processing++;
    try {
      const header = await this.store.header(
        operation.ownerId,
        operation.selectionId,
      );
      const input = JSON.parse(operation.input) as OperationInput;
      let state: Selection;
      if (
        input.action === 'create' ||
        (!header.currentRevisionId && input.action === 'filter')
      )
        state = await this.engine.initial(this.blank(header, input.filters));
      else
        state = await this.engine.evolve(
          await this.store.load(operation.ownerId, operation.selectionId),
          { ...input, action: input.action, version: operation.baseVersion },
        );
      await this.store.save(operation, state);
    } catch (error) {
      const message =
        error instanceof HttpException && error.getStatus() < 500
          ? error.message
          : 'Falha de processamento. A última revisão publicada foi preservada.';
      try {
        await this.store.fail(operation, message);
      } catch {
        this.logger.error(
          'recipient_selection_operation_error_registration_pending',
        );
      }
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException(
        'Processamento indisponível. A última revisão foi preservada; consulte a operação para recuperar.',
      );
    } finally {
      this.processing--;
    }
  }
  async get(ownerId: string, id: string, page: RecipientPageDto) {
    const header = await this.store.header(ownerId, id);
    const pending = await this.store.pending(ownerId, id);
    const state = header.currentRevisionId
      ? await this.engine.revalidate(
          await this.store.load(ownerId, id, header.currentRevisionId),
        )
      : {
          ...this.blank(
            header,
            pending
              ? (JSON.parse(pending.input) as OperationInput).filters
              : {},
          ),
          catalog: await this.catalog.fromIds([]),
        };
    // Do not expose a freshly queried catalog as a published revision after an
    // interrupted creation. Only a successful commit authorizes selection edits.
    if (!header.currentRevisionId) {
      state.catalog.rows = [];
      state.catalog.recordsFound = 0;
    }
    return {
      ...this.engine.present(state, page),
      revisionId: header.currentRevisionId,
      hasPublishedRevision: !!header.currentRevisionId,
      operation:
        pending?.status !== 'completed' ? this.operationView(pending) : null,
      persistence: 'sql' as const,
      expirationPolicy: '30_days_after_last_publication' as const,
    };
  }
  async latest(ownerId: string) {
    const header = await this.store.latest(ownerId);
    return header ? this.get(ownerId, header.id, new RecipientPageDto()) : null;
  }
  list(ownerId: string, page: RecipientPageDto) {
    return this.store.list(ownerId, page.page);
  }
  async operation(ownerId: string, requestId: string) {
    return this.operationView(await this.store.operation(ownerId, requestId));
  }
  async recover(ownerId: string, operationId: string) {
    if (this.processing >= 2)
      throw new ServiceUnavailableException(
        'Limite de processamento atingido.',
      );
    const claim = await this.store.retry(ownerId, operationId);
    if (claim.run) await this.execute(claim.operation);
    return this.get(
      ownerId,
      claim.operation.selectionId,
      new RecipientPageDto(),
    );
  }
  revisions(ownerId: string, id: string, page: RecipientPageDto) {
    return this.store.revisions(ownerId, id, page.page);
  }
  async historical(
    ownerId: string,
    id: string,
    revisionId: string,
    page: RecipientPageDto,
  ) {
    const state = await this.store.load(ownerId, id, revisionId);
    return {
      ...this.engine.present(state, page),
      revisionId,
      historical: true,
      readyForSending: false,
    };
  }
  sources(
    ownerId: string,
    id: string,
    revisionId: string,
    key: string,
    page: RecipientPageDto,
  ) {
    if (!/^[a-f0-9]{64}$/.test(key))
      throw new BadRequestException('Chave de contexto inválida.');
    return this.store.sources(ownerId, id, revisionId, key, page.page);
  }
}
