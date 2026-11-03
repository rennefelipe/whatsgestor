import { apiRequest } from './client';
import type { ExcelRow } from '../excel';

export interface ExchangeSummary {
  newRecords: number; existingContacts: number; updatedContacts: number; newContacts: number;
  newGroups: number; newShoppings: number; newOrganizations: number; updatedOrganizations: number;
  existingOrganizations: number; newContactTypes: number; newOrganizationTypes: number; errorLines: number; emptyLines: number;
}
export interface ExchangeReviewRow { row: number; values: ExcelRow; action: 'new' | 'existing' | 'update' | 'error' | 'empty'; actions: string[]; issues: string[] }
export interface ExchangePreview { id: string; expiresAt: number; rows: ExchangeReviewRow[]; summary: ExchangeSummary; canConfirm: boolean }
export interface ExchangeReport { state: 'completed'; summary: ExchangeSummary; rows: ExchangeReviewRow[]; imported: number; updated: number; existing: number }
export interface ExchangeFilters { search: string; isActive: string; organizationId: string }
export interface ExchangeOptions { standaloneTypes: { id: string; name: string }[]; organizations: { id: string; name: string; isActive: boolean; parentOrganizationId: string | null }[] }

export function getExchangeOptions(signal?: AbortSignal): Promise<ExchangeOptions> { return apiRequest('/data-exchange/options', { signal }); }
export function getExchangeExport(filters: ExchangeFilters): Promise<{ rows: ExcelRow[]; warnings: string[] }> {
  const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => !!value.trim()));
  return apiRequest(`/data-exchange/export?${query}`);
}
export function previewExchange(rows: ExcelRow[], standaloneOrganizationTypeId: string, replacePreviewId?: string): Promise<ExchangePreview> {
  const payload = JSON.stringify({ rows, ...(standaloneOrganizationTypeId ? { standaloneOrganizationTypeId } : {}), ...(replacePreviewId ? { replacePreviewId } : {}) });
  if (new TextEncoder().encode(payload).length > 8 * 1024 * 1024) throw new Error('O conteúdo da planilha excede 8 MB. Divida o arquivo em lotes menores.');
  // Scoped multipart upload uses the existing API client/session and avoids changing global JSON limits.
  const body = new FormData(); body.append('payload', new Blob([payload], { type: 'application/json' }), 'cadastros.json');
  return apiRequest('/data-exchange/preview-file', { method: 'POST', body });
}
export function commitExchange(id: string): Promise<ExchangeReport> { return apiRequest(`/data-exchange/${encodeURIComponent(id)}/commit`, { method: 'POST' }); }
export function getExchangeStatus(id: string): Promise<{ state: string; result?: ExchangeReport }> { return apiRequest(`/data-exchange/${encodeURIComponent(id)}`); }
