import { BadRequestException } from '@nestjs/common';
import type { FindContactsQueryDto } from '../contacts/dto/find-contacts-query.dto';
import {
  MAX_RECIPIENT_RECORDS,
  Recipient,
  RecipientCatalogService,
} from './recipient-catalog.service';
import {
  RecipientPageDto,
  UpdateRecipientSelectionDto,
} from './recipient-selection.dto';

export interface Selection {
  id: string;
  ownerId: string;
  version: number;
  expiresAt: number | null;
  filters: FindContactsQueryDto;
  catalog: Awaited<ReturnType<RecipientCatalogService['query']>>;
  selected: Map<string, Recipient>;
}
export class RecipientSelectionEngine {
  constructor(private readonly catalog: RecipientCatalogService) {}
  async initial(selection: Selection) {
    return {
      ...selection,
      catalog: await this.catalog.query(selection.filters),
    };
  }
  async revalidate(selection: Selection): Promise<Selection> {
    const queryIds = [
      ...new Set(selection.catalog.rows.flatMap((row) => row.contactIds)),
    ];
    const selectedIds = [
      ...new Set(
        [...selection.selected.values()].flatMap((row) => row.contactIds),
      ),
    ];
    const freshQuery = await this.catalog.fromIds(queryIds);
    const freshSelected = selectedIds.length
      ? await this.catalog.fromIds(selectedIds)
      : freshQuery;
    const refresher = (
      fresh: Awaited<ReturnType<RecipientCatalogService['fromIds']>>,
    ) => {
      const byKey = new Map(fresh.rows.map((row) => [row.key, row]));
      const sources = new Map(
        fresh.rows.flatMap((row) =>
          row.sourceSnapshots.map(
            (source) => [source.contactId, JSON.stringify(source)] as const,
          ),
        ),
      );
      return (row: Recipient): Recipient => {
        const updated = byKey.get(row.key);
        const unchanged =
          updated &&
          row.sourceSnapshots.every(
            (source) =>
              sources.get(source.contactId) === JSON.stringify(source),
          );
        if (!unchanged)
          return {
            ...row,
            eligible: false,
            reasons: [
              'Cadastro removido ou contexto alterado; remova e selecione novamente para revisar os dados atuais',
            ],
          };
        // Historical names/context/phone never change during an operational read.
        return {
          ...row,
          eligible: updated.eligible,
          reasons: updated.reasons,
          warnings: [...new Set([...row.warnings, ...updated.warnings])],
        };
      };
    };
    const refreshQuery = refresher(freshQuery),
      refreshSelected = refresher(freshSelected);
    return {
      ...selection,
      catalog: {
        ...selection.catalog,
        rows: selection.catalog.rows.map(refreshQuery),
        preferencesStatus: freshSelected.preferencesStatus,
      },
      selected: new Map(
        [...selection.selected].map(([key, row]) => [
          key,
          refreshSelected(row),
        ]),
      ),
    };
  }
  async evolve(
    selection: Selection,
    dto: UpdateRecipientSelectionDto,
  ): Promise<Selection> {
    const filters = dto.action === 'filter' ? dto.filters : selection.filters;
    if (!filters)
      throw new BadRequestException('Informe os filtros da consulta.');
    const catalog = await this.catalog.query(filters);
    const selected = new Map(selection.selected);
    const include = (row: Recipient) => {
      const previous = selected.get(row.key);
      if (!previous) {
        selected.set(row.key, row);
        return;
      }
      const sources = new Map(
        previous.sourceSnapshots.map((source) => [source.contactId, source]),
      );
      for (const source of row.sourceSnapshots)
        if (!sources.has(source.contactId))
          sources.set(source.contactId, source);
      selected.set(row.key, {
        ...previous,
        contactIds: [...sources.keys()],
        sourceSnapshots: [...sources.values()],
        names: [
          ...new Set([...sources.values()].map((source) => source.contactName)),
        ],
        originalPhones: [
          ...new Set(
            [...sources.values()].map((source) => source.originalPhone),
          ),
        ],
        verifiedIdentityScopes: [
          ...new Set(
            [...sources.values()].flatMap(
              (source) => source.verifiedIdentityScopes,
            ),
          ),
        ],
      });
    };
    if (dto.action === 'clear') selected.clear();
    if (dto.action === 'remove') {
      if (!dto.key) throw new BadRequestException('Informe o destinatário.');
      selected.delete(dto.key);
    }
    if (dto.action === 'add') {
      const row = catalog.rows.find((row) => row.key === dto.key);
      if (!row?.eligible)
        throw new BadRequestException(
          'Destinatario impedido ou fora da consulta atual.',
        );
      include(row);
    }
    if (dto.action === 'all')
      for (const row of catalog.rows) if (row.eligible) include(row);
    if (
      [...selected.values()].reduce(
        (sum, row) => sum + row.contactIds.length,
        0,
      ) > MAX_RECIPIENT_RECORDS
    )
      throw new BadRequestException(
        'Limite de 10.000 cadastros da seleção atingido. Nenhum resultado parcial foi publicado.',
      );
    return this.revalidate({ ...selection, filters, catalog, selected });
  }
  present(selection: Selection, page: RecipientPageDto) {
    const selected = [...selection.selected.values()];
    const rows = page.view === 'selected' ? selected : selection.catalog.rows;
    const currentPage = Math.min(
      page.page,
      Math.max(1, Math.ceil(rows.length / page.pageSize)),
    );
    const selectedEligible = selected.filter((row) => row.eligible);
    const counts = new Map<string, number>();
    for (const row of selectedEligible)
      if (row.normalizedPhone)
        counts.set(
          row.normalizedPhone,
          (counts.get(row.normalizedPhone) ?? 0) + 1,
        );
    const items = rows
      .slice((currentPage - 1) * page.pageSize, currentPage * page.pageSize)
      .map((original) => {
        const row = selection.selected.get(original.key) ?? original;
        return {
          ...row,
          sourceSnapshots: undefined,
          sourceCount: row.contactIds.length,
          sourcePreviewTruncated: row.contactIds.length > 25,
          contactIds: row.contactIds.slice(0, 25),
          names: row.names.slice(0, 25),
          originalPhones: row.originalPhones.slice(0, 25),
          selected: selection.selected.has(row.key),
          warnings: [
            ...new Set([
              ...row.warnings,
              ...(row.normalizedPhone &&
              (counts.get(row.normalizedPhone) ?? 0) > 1
                ? ['Mesmo número selecionado em mais de um contexto']
                : []),
            ]),
          ],
        };
      });
    return {
      id: selection.id,
      version: selection.version,
      expiresAt:
        selection.expiresAt === null
          ? null
          : new Date(selection.expiresAt).toISOString(),
      filters: selection.filters,
      items,
      total: rows.length,
      page: currentPage,
      pageSize: page.pageSize,
      view: page.view,
      preferencesStatus: selection.catalog.preferencesStatus,
      readyForSending: false,
      summary: {
        recordsFound: selection.catalog.recordsFound,
        recipientsFound: selection.catalog.rows.length,
        eligibleFound: selection.catalog.rows.filter((row) => row.eligible)
          .length,
        selectedRecipients: selected.length,
        selectedEligible: selectedEligible.length,
        uniqueNumbers: counts.size,
        duplicatesIdentified:
          selection.catalog.recordsFound - selection.catalog.rows.length,
        blockedRecipients: selection.catalog.rows.filter((row) => !row.eligible)
          .length,
        blockedSelected: selected.length - selectedEligible.length,
        repeatedSelectedNumbers: [...counts.values()].filter(
          (count) => count > 1,
        ).length,
      },
    };
  }
}
