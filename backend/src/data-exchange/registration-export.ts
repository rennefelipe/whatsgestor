import { BadRequestException } from '@nestjs/common';
import { normalizeStoreName } from '../contacts/contact-normalization';
import { organizationRole } from '../contacts/organization-context';
import { Catalog, ContactRecord, OrganizationRecord, RegistrationRow, REGISTRATION_COLUMNS } from './registration-plan';

export interface ExportFilters { search?: string; isActive?: string; organizationId?: string }
const nameKey = (value?: string | null) => normalizeStoreName(value) ?? '';

export function exportRegistrations(catalog: Catalog, filters: ExportFilters = {}): { rows: RegistrationRow[]; warnings: string[] } {
  const byId = new Map(catalog.organizations.map(item => [item.id.toLowerCase(), item]));
  const types = new Map(catalog.organizationTypes.map(item => [item.id.toLowerCase(), item]));
  const roles = new Map(catalog.contactTypes.map(item => [item.id.toLowerCase(), item]));
  const warnings = new Set<string>();
  function context(organization: OrganizationRecord | undefined) {
    if (!organization) return { group: '', organization: '' };
    const visited = new Set<string>(); let current: OrganizationRecord | undefined = organization, group = '';
    while (current) {
      if (visited.has(current.id.toLowerCase())) throw new BadRequestException(`A organização “${organization.name}” possui um ciclo. Corrija a hierarquia antes de exportar.`);
      visited.add(current.id.toLowerCase());
      if (organizationRole(types.get(current.organizationTypeId.toLowerCase())?.name) === 'group') {
        if (current.parentOrganizationId) throw new BadRequestException(`O grupo “${current.name}” possui vínculo pai incompatível. Revise antes de exportar.`);
        group = current.name; break;
      }
      if (current.parentOrganizationId && !byId.has(current.parentOrganizationId.toLowerCase())) throw new BadRequestException(`A organização pai de “${current.name}” não foi encontrada.`);
      current = current.parentOrganizationId ? byId.get(current.parentOrganizationId.toLowerCase()) : undefined;
    }
    return { group, organization: organizationRole(types.get(organization.organizationTypeId.toLowerCase())?.name) === 'group' ? '' : organization.name };
  }
  const empty = (): RegistrationRow => Object.fromEntries(REGISTRATION_COLUMNS.map(column => [column, '']));
  const matchesStatus = (active: boolean) => !filters.isActive || active === (filters.isActive === 'true');
  const search = nameKey(filters.search);
  const organizationMatches = (item: OrganizationRecord) => {
    if (!filters.organizationId) return true;
    let current: OrganizationRecord | undefined = item; const seen = new Set<string>();
    while (current && !seen.has(current.id)) {
      if (current.id.toLowerCase() === filters.organizationId.toLowerCase()) return true;
      seen.add(current.id); current = current.parentOrganizationId ? byId.get(current.parentOrganizationId.toLowerCase()) : undefined;
    }
    return false;
  };
  const rows: RegistrationRow[] = [], represented = new Set<string>();
  function organizationalRow(item: OrganizationRecord) {
    if (represented.has(item.id)) return;
    const place = context(item);
    rows.push({ ...empty(), Grupo: place.group, 'Organização / Shopping': place.organization, Ativo: item.isActive ? 'Sim' : 'Não' });
    represented.add(item.id);
  }
  function addAncestors(item: OrganizationRecord) {
    const parent = item.parentOrganizationId ? byId.get(item.parentOrganizationId.toLowerCase()) : undefined;
    if (parent) { context(parent); addAncestors(parent); organizationalRow(parent); }
  }
  function contactRow(contact: ContactRecord): RegistrationRow {
    const organization = contact.organizationId ? byId.get(contact.organizationId.toLowerCase()) : undefined;
    if (contact.organizationId && !organization) throw new BadRequestException(`Organização de “${contact.contactName}” não encontrada. Nenhum arquivo parcial foi gerado.`);
    const role = roles.get(contact.contactTypeId.toLowerCase());
    if (!role) throw new BadRequestException(`Tipo de contato de “${contact.contactName}” não encontrado.`);
    const place = context(organization);
    return { Grupo: place.group, 'Organização / Shopping': place.organization, Loja: contact.storeName ?? '', Responsável: contact.contactName, WhatsApp: contact.phone, 'Tipo de contato': role.name, 'E-mail': contact.email ?? '', Ativo: contact.isActive ? 'Sim' : 'Não' };
  }
  const selectedContacts = catalog.contacts.filter(contact => {
    const organization = contact.organizationId ? byId.get(contact.organizationId.toLowerCase()) : undefined;
    const row = contactRow(contact);
    return matchesStatus(contact.isActive) && (!filters.organizationId || !!organization && organizationMatches(organization)) && (!search || Object.values(row).some(value => nameKey(value).includes(search)));
  });
  const sortedOrganizations = [...catalog.organizations].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  for (const organization of sortedOrganizations) {
    const place = context(organization);
    if (matchesStatus(organization.isActive) && organizationMatches(organization) && (!search || [place.group, place.organization].some(value => nameKey(value).includes(search)))) {
      addAncestors(organization); organizationalRow(organization);
    }
  }
  for (const contact of selectedContacts.sort((a, b) => a.contactName.localeCompare(b.contactName, 'pt-BR'))) {
    const organization = contact.organizationId ? byId.get(contact.organizationId.toLowerCase()) : undefined;
    if (organization) { addAncestors(organization); organizationalRow(organization); }
    rows.push(contactRow(contact));
  }
  if (rows.length > 10000) throw new BadRequestException('A exportação excede 10.000 linhas. Refine os filtros; nenhum arquivo parcial foi gerado.');
  if (Buffer.byteLength(JSON.stringify({ rows }), 'utf8') > 8 * 1024 * 1024 - 1024)
    throw new BadRequestException('O conteúdo excede o limite de reimportação de 8 MB. Refine os filtros; nenhum arquivo parcial foi gerado.');
  if (filters.search || filters.isActive || filters.organizationId) warnings.add('As organizações necessárias aos vínculos acompanham os contatos selecionados, preservando sua situação original.');
  return { rows, warnings: [...warnings] };
}
