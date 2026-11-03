import {
  ConflictException,
  GoneException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager, IsNull, MoreThan, Not } from 'typeorm';
import {
  RecipientSelection as Header,
  RecipientSelectionRevision as Revision,
  RecipientSelectionItem as Item,
  RecipientSelectionSource as Source,
  RecipientSelectionOperation as Operation,
} from './entities/recipient-selection.entity';
import type { Selection } from './recipient-selection-engine';
import {
  NORMALIZATION_VERSION,
  Recipient,
  RecipientSourceSnapshot,
} from './recipient-catalog.service';
import type { FindContactsQueryDto } from '../contacts/dto/find-contacts-query.dto';
import type { UpdateRecipientSelectionDto } from './recipient-selection.dto';

export const SELECTION_TTL = 30 * 24 * 60 * 60 * 1000;
export const OPERATION_LEASE = 15 * 60 * 1000;
export const PERSISTENCE_BATCH = 100;
export interface OperationInput {
  action: 'create' | UpdateRecipientSelectionDto['action'];
  filters?: FindContactsQueryDto;
  key?: string;
}
export abstract class SelectionStore {
  abstract list(
    ownerId: string,
    page: number,
  ): Promise<{ items: Header[]; total: number }>;
  abstract latest(ownerId: string): Promise<Header | null>;
  abstract header(ownerId: string, id: string): Promise<Header>;
  abstract load(
    ownerId: string,
    id: string,
    revisionId?: string,
  ): Promise<Selection>;
  abstract begin(
    ownerId: string,
    id: string | null,
    requestId: string,
    version: number,
    input: OperationInput,
  ): Promise<{ operation: Operation; run: boolean }>;
  abstract retry(
    ownerId: string,
    operationId: string,
  ): Promise<{ operation: Operation; run: boolean }>;
  abstract operation(ownerId: string, requestId: string): Promise<Operation>;
  abstract pending(ownerId: string, id: string): Promise<Operation | null>;
  abstract save(operation: Operation, selection: Selection): Promise<void>;
  abstract fail(operation: Operation, message: string): Promise<void>;
  abstract revisions(
    ownerId: string,
    id: string,
    page: number,
  ): Promise<{ items: Revision[]; total: number }>;
  abstract sources(
    ownerId: string,
    id: string,
    revisionId: string,
    key: string,
    page: number,
  ): Promise<{ items: RecipientSourceSnapshot[]; total: number }>;
}

@Injectable()
export class SqlRecipientSelectionStore extends SelectionStore {
  private readonly logger = new Logger(SqlRecipientSelectionStore.name);
  constructor(private readonly database: DataSource) {
    super();
  }
  private async safe<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof HttpException) throw error;
      const number = (error as { driverError?: { number?: number }; number?: number })
        ?.driverError?.number ?? (error as { number?: number })?.number;
      if (number === 2601 || number === 2627)
        throw new ConflictException(
          'Operação concorrente ou chave de solicitação repetida. Consulte o progresso antes de tentar novamente.',
        );
      const schemaMissing = number === 207 || number === 208;
      this.logger.warn(JSON.stringify({ stage: 'recipient_selection_storage_failed',
        code: schemaMissing ? 'RECIPIENT_SELECTION_SCHEMA_MISSING' : 'RECIPIENT_SELECTION_STORAGE_UNAVAILABLE',
        ...(Number.isInteger(number) ? { sqlNumber: number } : {}) }));
      throw new ServiceUnavailableException({
        code: schemaMissing ? 'RECIPIENT_SELECTION_SCHEMA_MISSING' : 'RECIPIENT_SELECTION_STORAGE_UNAVAILABLE',
        message: schemaMissing
          ? 'Estrutura SQL de seleções ausente ou incompatível. Solicite revisão da migration incremental; nenhuma estrutura foi alterada automaticamente.'
          : 'Persistência de seleções indisponível. Verifique a conexão e o acesso SQL. A seleção existente foi preservada; não há armazenamento alternativo em memória.',
      });
    }
  }
  private async owned(
    manager: EntityManager,
    ownerId: string,
    id: string,
    historical = false,
  ) {
    const row = await manager.getRepository(Header).findOneBy({ id, ownerId });
    if (!row) throw new NotFoundException('Seleção não encontrada.');
    if (
      !historical &&
      !row.retained &&
      (!row.expiresAt || row.expiresAt.getTime() <= Date.now())
    )
      throw new GoneException(
        'Seleção preparatória expirada. O histórico foi preservado.',
      );
    return row;
  }
  latest(ownerId: string) {
    return this.safe(() =>
      this.database.getRepository(Header).findOne({
        where: [
          { ownerId, retained: true },
          { ownerId, expiresAt: MoreThan(new Date()) },
        ],
        order: { updatedAt: 'DESC', id: 'DESC' },
      }),
    );
  }
  list(ownerId: string, page: number) {
    return this.safe(async () => {
      const [items, total] = await this.database
        .getRepository(Header)
        .findAndCount({
          where: { ownerId },
          order: { updatedAt: 'DESC', id: 'DESC' },
          skip: (page - 1) * 25,
          take: 25,
        });
      return { items, total };
    });
  }
  header(ownerId: string, id: string) {
    return this.safe(() => this.owned(this.database.manager, ownerId, id));
  }
  async load(
    ownerId: string,
    id: string,
    revisionId?: string,
  ): Promise<Selection> {
    return this.safe(async () => {
      const header = await this.owned(
        this.database.manager,
        ownerId,
        id,
        !!revisionId,
      );
      if (!revisionId && !header.currentRevisionId)
        throw new ConflictException('Revisão ainda não publicada.');
      const revision = await this.database.getRepository(Revision).findOneBy({
        id: revisionId ?? header.currentRevisionId ?? '',
        selectionId: id,
        status: 'ready',
      });
      if (!revision)
        throw new ConflictException(
          'A seleção ainda não possui revisão publicada. Consulte a operação pendente.',
        );
      const metadata = JSON.parse(revision.metadata) as {
        filters: Selection['filters'];
        recordsFound: number;
        preferencesStatus: Selection['catalog']['preferencesStatus'];
      };
      const byItem = new Map<
        string,
        { row: Recipient; selected: boolean; inQuery: boolean }
      >();
      for (let offset = 0; ; offset += 200) {
        const rows = await this.database.getRepository(Item).find({
          where: { revisionId: revision.id },
          order: { ordinal: 'ASC' },
          skip: offset,
          take: 200,
        });
        for (const item of rows)
          byItem.set(item.id, {
            row: {
              ...(JSON.parse(item.snapshot) as Recipient),
              sourceSnapshots: [],
            },
            selected: item.selected,
            inQuery: item.inQuery,
          });
        if (byItem.size > 20000)
          throw new ConflictException(
            'Revisão excede o limite seguro de destinatários.',
          );
        if (rows.length < 200) break;
      }
      let sourceCount = 0;
      for (let offset = 0; ; offset += 200) {
        const rows = await this.database.getRepository(Source).find({
          where: { revisionId: revision.id },
          order: { id: 'ASC' },
          skip: offset,
          take: 200,
        });
        for (const source of rows) {
          const item = byItem.get(source.itemId);
          if (!item)
            throw new ConflictException(
              'Referência de origem inconsistente na revisão.',
            );
          item.row.sourceSnapshots.push(
            JSON.parse(source.snapshot) as RecipientSourceSnapshot,
          );
        }
        sourceCount += rows.length;
        if (sourceCount > 20000)
          throw new ConflictException(
            'Revisão excede o limite seguro de origens.',
          );
        if (rows.length < 200) break;
      }
      for (const { row } of byItem.values()) {
        const positions = new Map(
          row.contactIds.map((contactId, index) => [contactId, index]),
        );
        row.sourceSnapshots.sort(
          (a, b) => positions.get(a.contactId)! - positions.get(b.contactId)!,
        );
        if (row.contactIds.length !== row.sourceSnapshots.length)
          throw new ConflictException(
            'Origens incompletas: a revisão não pode ser utilizada.',
          );
      }
      return {
        id,
        ownerId,
        version: revision.version,
        expiresAt: header.expiresAt?.getTime() ?? null,
        filters: metadata.filters,
        catalog: {
          rows: [...byItem.values()]
            .filter((item) => item.inQuery)
            .map((item) => item.row),
          recordsFound: metadata.recordsFound,
          preferencesStatus: metadata.preferencesStatus,
        },
        selected: new Map(
          [...byItem.values()]
            .filter((item) => item.selected)
            .map((item) => [item.row.key, item.row]),
        ),
      };
    });
  }
  operation(ownerId: string, requestId: string) {
    return this.safe(async () => {
      const operation = await this.database
        .getRepository(Operation)
        .findOneBy({ ownerId, requestId });
      if (!operation) throw new NotFoundException('Operação não encontrada.');
      await this.owned(this.database.manager, ownerId, operation.selectionId);
      return operation;
    });
  }
  pending(ownerId: string, id: string) {
    return this.safe(async () => {
      const header = await this.owned(this.database.manager, ownerId, id);
      if (header.activeOperationId)
        return this.database
          .getRepository(Operation)
          .findOneBy({ id: header.activeOperationId, ownerId });
      if (header.lastOperationId)
        return this.database
          .getRepository(Operation)
          .findOneBy({ id: header.lastOperationId, ownerId });
      return this.database.getRepository(Operation).findOne({
        where: { selectionId: id, ownerId },
        order: { updatedAt: 'DESC', id: 'DESC' },
      });
    });
  }
  begin(
    ownerId: string,
    id: string | null,
    requestId: string,
    version: number,
    input: OperationInput,
  ) {
    return this.safe(() =>
      this.database.transaction(async (manager) => {
        const existing = await manager
          .getRepository(Operation)
          .findOneBy({ ownerId, requestId });
        if (existing) {
          if (
            (id && existing.selectionId !== id) ||
            existing.input !== JSON.stringify(input) ||
            existing.baseVersion !== version
          )
            throw new ConflictException(
              'Chave de idempotência utilizada com outro conteúdo.',
            );
          await this.owned(manager, ownerId, existing.selectionId);
          return { operation: existing, run: false };
        }
        if (!id) {
          await manager
            .getRepository(Header)
            .createQueryBuilder()
            .update()
            .set({ slot: null })
            .where(
              'ownerId = :ownerId AND retained = 0 AND expiresAt <= :now',
              { ownerId, now: new Date() },
            )
            .execute();
          const active = await manager.getRepository(Header).find({
            where: { ownerId, slot: Not(IsNull()) },
            select: { slot: true },
            take: 3,
          });
          const slot = [0, 1, 2].find(
            (value) => !active.some((row) => row.slot === value),
          );
          if (slot === undefined)
            throw new ConflictException(
              'Limite de três seleções preparatórias por usuário atingido. Recupere uma seleção existente.',
            );
          id = randomUUID();
          await manager.getRepository(Header).insert({
            id,
            ownerId,
            slot,
            version: 0,
            retained: false,
            expiresAt: new Date(Date.now() + SELECTION_TTL),
            currentRevisionId: null,
            activeOperationId: null,
            lastOperationId: null,
            updatedAt: new Date(),
          });
        }
        const header = await this.owned(manager, ownerId, id);
        if (header.version !== version || header.activeOperationId)
          throw new ConflictException(
            'A seleção mudou ou está em processamento. Atualize antes de continuar.',
          );
        const operation = manager.getRepository(Operation).create({
          id: randomUUID(),
          selectionId: id,
          ownerId,
          requestId,
          revisionId: randomUUID(),
          leaseToken: randomUUID(),
          leaseExpiresAt: new Date(Date.now() + OPERATION_LEASE),
          baseVersion: version,
          attempt: 1,
          status: 'building',
          input: JSON.stringify(input),
          errors: '[]',
          processed: 0,
          total: 0,
          updatedAt: new Date(),
        });
        const claim = await manager.getRepository(Header).update(
          { id, ownerId, version, activeOperationId: IsNull() },
          {
            activeOperationId: operation.id,
            lastOperationId: operation.id,
            updatedAt: new Date(),
          },
        );
        if (claim.affected !== 1)
          throw new ConflictException(
            'A seleção mudou ou está em processamento.',
          );
        await manager.getRepository(Revision).insert({
          id: operation.revisionId,
          selectionId: id,
          version: version + 1,
          status: 'building',
          metadata: '{}',
          normalizationVersion: NORMALIZATION_VERSION,
        });
        await manager.getRepository(Operation).insert(operation);
        return { operation, run: true };
      }),
    );
  }
  retry(ownerId: string, operationId: string) {
    return this.safe(() =>
      this.database.transaction(async (manager) => {
        const old = await manager
          .getRepository(Operation)
          .findOneBy({ id: operationId, ownerId });
        if (!old) throw new NotFoundException('Operação não encontrada.');
        const header = await this.owned(manager, ownerId, old.selectionId);
        if (old.status === 'completed') return { operation: old, run: false };
        if (
          old.status === 'building' &&
          old.leaseExpiresAt.getTime() > Date.now()
        )
          throw new ConflictException(
            'Operação ainda possui licença de processamento válida. Aguarde o prazo informado.',
          );
        if (
          header.version !== old.baseVersion ||
          (header.activeOperationId && header.activeOperationId !== old.id)
        )
          throw new ConflictException(
            'A seleção já possui uma revisão ou operação posterior. Não é seguro sobrescrevê-la.',
          );
        const token = randomUUID(),
          revisionId = randomUUID();
        const result = await manager.getRepository(Operation).update(
          {
            id: old.id,
            ownerId,
            leaseToken: old.leaseToken,
            status: old.status,
          },
          {
            leaseToken: token,
            revisionId,
            attempt: old.attempt + 1,
            status: 'building',
            processed: 0,
            total: 0,
            leaseExpiresAt: new Date(Date.now() + OPERATION_LEASE),
            updatedAt: new Date(),
            errors: JSON.stringify([
              ...(JSON.parse(old.errors) as unknown[]),
              {
                at: new Date().toISOString(),
                message:
                  'Recuperação: tentativa anterior abandonada; reconstrução integral.',
              },
            ]),
          },
        );
        if (result.affected !== 1)
          throw new ConflictException('Outra recuperação está em andamento.');
        const claim = await manager.getRepository(Header).update(
          {
            id: header.id,
            ownerId,
            version: old.baseVersion,
            activeOperationId: header.activeOperationId ?? IsNull(),
          },
          {
            activeOperationId: old.id,
            lastOperationId: old.id,
            updatedAt: new Date(),
          },
        );
        if (claim.affected !== 1)
          throw new ConflictException('A seleção mudou durante a recuperação.');
        await manager
          .getRepository(Revision)
          .update(
            { id: old.revisionId, status: 'building' },
            { status: 'failed' },
          );
        await manager.getRepository(Revision).insert({
          id: revisionId,
          selectionId: header.id,
          version: old.baseVersion + 1,
          status: 'building',
          metadata: '{}',
          normalizationVersion: NORMALIZATION_VERSION,
        });
        return {
          operation: {
            ...old,
            leaseToken: token,
            revisionId,
            status: 'building' as const,
            processed: 0,
            total: 0,
            attempt: old.attempt + 1,
          },
          run: true,
        };
      }),
    );
  }
  private async lease(
    manager: EntityManager,
    operation: Operation,
    processed: number,
    total: number,
  ) {
    const result = await manager.getRepository(Operation).update(
      {
        id: operation.id,
        ownerId: operation.ownerId,
        leaseToken: operation.leaseToken,
        status: 'building',
      },
      {
        processed,
        total,
        leaseExpiresAt: new Date(Date.now() + OPERATION_LEASE),
        updatedAt: new Date(),
      },
    );
    if (result.affected !== 1)
      throw new ConflictException(
        'O processamento foi assumido por outra tentativa.',
      );
  }
  async save(operation: Operation, selection: Selection) {
    return this.safe(async () => {
      const combined = [
        ...selection.catalog.rows.map((row) => ({
          row,
          selected: false,
          inQuery: true,
        })),
        ...[...selection.selected.values()].map((row) => ({
          row,
          selected: true,
          inQuery: false,
        })),
      ];
      const items: Item[] = [],
        sources: Source[] = [];
      for (const { row, selected, inQuery } of combined) {
        const id = randomUUID();
        const { sourceSnapshots, ...payload } = row;
        items.push({
          id,
          revisionId: operation.revisionId,
          contextKey: row.key,
          ordinal: items.length,
          selected,
          inQuery,
          snapshot: JSON.stringify(payload),
        });
        for (const snapshot of sourceSnapshots)
          sources.push({
            id: randomUUID(),
            revisionId: operation.revisionId,
            itemId: id,
            contactId: snapshot.contactId,
            snapshot: JSON.stringify(snapshot),
          });
      }
      if (items.length > 20000 || sources.length > 20000)
        throw new ConflictException(
          'Limite de materialização excedido; nada foi publicado.',
        );
      const total = items.length + sources.length;
      let processed = 0;
      await this.database.transaction((manager) =>
        this.lease(manager, operation, 0, total),
      );
      for (let offset = 0; offset < items.length; offset += PERSISTENCE_BATCH) {
        const batch = items.slice(offset, offset + PERSISTENCE_BATCH);
        await this.database.transaction(async (manager) => {
          await this.lease(manager, operation, processed + batch.length, total);
          await manager.getRepository(Item).insert(batch);
        });
        processed += batch.length;
      }
      for (
        let offset = 0;
        offset < sources.length;
        offset += PERSISTENCE_BATCH
      ) {
        const batch = sources.slice(offset, offset + PERSISTENCE_BATCH);
        await this.database.transaction(async (manager) => {
          await this.lease(manager, operation, processed + batch.length, total);
          await manager.getRepository(Source).insert(batch);
        });
        processed += batch.length;
      }
      await this.database.transaction(async (manager) => {
        await this.lease(manager, operation, total, total);
        const header = await this.owned(
          manager,
          operation.ownerId,
          operation.selectionId,
        );
        const published = await manager.getRepository(Header).update(
          {
            id: header.id,
            ownerId: operation.ownerId,
            version: operation.baseVersion,
            activeOperationId: operation.id,
          },
          {
            currentRevisionId: operation.revisionId,
            activeOperationId: null,
            version: operation.baseVersion + 1,
            updatedAt: new Date(),
            expiresAt: header.retained
              ? null
              : new Date(Date.now() + SELECTION_TTL),
          },
        );
        if (published.affected !== 1)
          throw new ConflictException(
            'A revisão anterior mudou; o resultado não foi publicado.',
          );
        const revisionUpdate = await manager.getRepository(Revision).update(
          {
            id: operation.revisionId,
            selectionId: header.id,
            status: 'building',
          },
          {
            status: 'ready',
            metadata: JSON.stringify({
              filters: selection.filters,
              recordsFound: selection.catalog.recordsFound,
              preferencesStatus: selection.catalog.preferencesStatus,
            }),
          },
        );
        if (revisionUpdate.affected !== 1)
          throw new ConflictException(
            'Revisão em construcao inconsistente; publicação cancelada.',
          );
        const operationUpdate = await manager.getRepository(Operation).update(
          {
            id: operation.id,
            leaseToken: operation.leaseToken,
            status: 'building',
          },
          { status: 'completed' },
        );
        if (operationUpdate.affected !== 1)
          throw new ConflictException(
            'Operação inconsistente; publicação cancelada.',
          );
      });
    });
  }
  async fail(operation: Operation, message: string) {
    return this.safe(() =>
      this.database.transaction(async (manager) => {
        const current = await manager.getRepository(Operation).findOneBy({
          id: operation.id,
          leaseToken: operation.leaseToken,
          status: 'building',
        });
        if (!current) return;
        const result = await manager.getRepository(Operation).update(
          {
            id: operation.id,
            leaseToken: operation.leaseToken,
            status: 'building',
          },
          {
            status: 'failed',
            updatedAt: new Date(),
            errors: JSON.stringify([
              ...(JSON.parse(current.errors) as unknown[]),
              { at: new Date().toISOString(), message },
            ]),
          },
        );
        if (result.affected === 1) {
          await manager
            .getRepository(Revision)
            .update(
              { id: operation.revisionId, status: 'building' },
              { status: 'failed' },
            );
          await manager.getRepository(Header).update(
            {
              id: operation.selectionId,
              ownerId: operation.ownerId,
              activeOperationId: operation.id,
            },
            { activeOperationId: null },
          );
        }
      }),
    );
  }
  revisions(ownerId: string, id: string, page: number) {
    return this.safe(async () => {
      await this.owned(this.database.manager, ownerId, id, true);
      const [items, total] = await this.database
        .getRepository(Revision)
        .findAndCount({
          where: { selectionId: id },
          order: { createdAt: 'DESC', id: 'DESC' },
          skip: (page - 1) * 25,
          take: 25,
        });
      return { items, total };
    });
  }
  sources(
    ownerId: string,
    id: string,
    revisionId: string,
    key: string,
    page: number,
  ) {
    return this.safe(async () => {
      await this.owned(this.database.manager, ownerId, id, true);
      const revision = await this.database
        .getRepository(Revision)
        .findOneBy({ id: revisionId, selectionId: id, status: 'ready' });
      if (!revision) throw new NotFoundException('Revisão não encontrada.');
      const item = await this.database.getRepository(Item).findOne({
        where: { revisionId, contextKey: key },
        order: { selected: 'DESC' },
      });
      if (!item) throw new NotFoundException('Destinatário não encontrado.');
      const [rows, total] = await this.database
        .getRepository(Source)
        .findAndCount({
          where: { itemId: item.id, revisionId },
          order: { id: 'ASC' },
          skip: (page - 1) * 25,
          take: 25,
        });
      return {
        items: rows.map(
          (row) => JSON.parse(row.snapshot) as RecipientSourceSnapshot,
        ),
        total,
      };
    });
  }
}
