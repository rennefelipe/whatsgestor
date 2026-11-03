"use client";
import { useCallback, useEffect, useState } from 'react';
import { getExchangeOptions, type ExchangeFilters, type ExchangeOptions } from '@/services/api/data-exchange';
import { useAuth } from '../auth/auth-provider';
import { ExcelActions } from '../excel-actions';

export function DataExchangeScreen() {
  const { user } = useAuth();
  const [filters, setFilters] = useState<ExchangeFilters>({ search: '', isActive: '', organizationId: '' });
  const [options, setOptions] = useState<ExchangeOptions>({ standaloneTypes: [], organizations: [] });
  const [error, setError] = useState('');
  const load = useCallback(async (signal?: AbortSignal) => {
    try { const value = await getExchangeOptions(signal); if (!signal?.aborted) { setOptions(value); setError(''); } }
    catch (error) { if (!signal?.aborted) setError(error instanceof Error ? error.message : 'Não foi possível carregar os cadastros.'); }
  }, []);
  useEffect(() => { const controller = new AbortController(); void Promise.resolve().then(() => { if (!controller.signal.aborted) void load(controller.signal); }); return () => controller.abort(); }, [load]);
  const organizationLabel = (id: string, visited = new Set<string>()): string => {
    const item = options.organizations.find(item => item.id === id);
    if (!item || visited.has(id)) return item?.name ?? '';
    visited.add(id);
    return item.parentOrganizationId ? `${organizationLabel(item.parentOrganizationId, visited)} › ${item.name}` : item.name;
  };
  return <main className="main-content settings-content exchange-content">
    <div className="page-heading"><div><p className="eyebrow">Cadastros em uma única planilha</p><h1>Importação e exportação</h1><p className="page-subtitle">Importe ou exporte grupos, shoppings, lojas e contatos em uma única planilha Excel.</p></div></div>
    {error && <p className="inline-error" role="alert">{error} <button type="button" className="secondary-button" onClick={() => void load()}>Tentar novamente</button></p>}
    <section className="exchange-guide" aria-labelledby="exchange-guide-title"><h2 id="exchange-guide-title">Um arquivo. Uma aba: Cadastros.</h2><p>Preencha nomes e números de telefone. Grupos, organizações e tipos serão conferidos antes de qualquer alteração. Loja continua sendo um campo opcional do contato.</p><p>Para cadastrar somente uma organização, deixe os campos de contato vazios. Para contatos independentes, deixe Grupo e Organização / Shopping vazios.</p></section>
    <section aria-label="Filtros da exportação" className="entity-toolbar exchange-filters">
      <label className="contact-filter-field"><span>Busca na exportação</span><input type="search" placeholder="Nome, WhatsApp, loja ou organização" value={filters.search} onChange={event => setFilters({ ...filters, search: event.target.value })} /></label>
      <label className="contact-filter-field"><span>Organização e vinculadas</span><select value={filters.organizationId} onChange={event => setFilters({ ...filters, organizationId: event.target.value })}><option value="">Todas as organizações</option>{options.organizations.map(item => <option key={item.id} value={item.id}>{organizationLabel(item.id)}{item.isActive ? '' : ' (inativa)'}</option>)}</select></label>
      <label className="contact-filter-field"><span>Situação</span><select value={filters.isActive} onChange={event => setFilters({ ...filters, isActive: event.target.value })}><option value="">Todas</option><option value="true">Ativos</option><option value="false">Inativos</option></select></label>
    </section>
    <ExcelActions isAdmin={!!user?.isAdmin} filters={filters} standaloneTypes={options.standaloneTypes} onImported={() => void load()} />
    <p className="recipient-help">A exportação inclui os vínculos organizacionais necessários aos resultados filtrados. Nenhum dado de autenticação ou histórico de mensagens é incluído.</p>
  </main>;
}
