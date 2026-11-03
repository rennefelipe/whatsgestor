import { isEmail } from 'class-validator';
import { normalizeContactPhone, normalizeStoreName } from '../contacts/contact-normalization';
import { organizationRole } from '../contacts/organization-context';

export const REGISTRATION_COLUMNS = ['Grupo', 'Organização / Shopping', 'Loja', 'Responsável', 'WhatsApp', 'Tipo de contato', 'E-mail', 'Ativo'] as const;
export type RegistrationRow = Record<string, string>;
interface Named { id: string; name: string; isActive: boolean }
export interface OrganizationRecord extends Named { organizationTypeId: string; parentOrganizationId: string | null }
export interface ContactRecord {
  id: string; organizationId: string | null; contactTypeId: string; storeName: string | null;
  contactName: string; phone: string; email: string | null; isActive: boolean;
}
export interface Catalog { organizationTypes: Named[]; organizations: OrganizationRecord[]; contactTypes: Named[]; contacts: ContactRecord[] }
export interface ImportOptions { standaloneOrganizationTypeId?: string }
export type EntityKind = 'organizationType' | 'organization' | 'contactType' | 'contact';
export interface Operation {
  kind: EntityKind; action: 'create' | 'update'; key: string;
  data: Record<string, string | boolean | null>;
}
export interface ReviewRow {
  row: number; values: RegistrationRow; action: 'new' | 'existing' | 'update' | 'error' | 'empty';
  actions: string[]; issues: string[];
}
export interface ImportSummary {
  newRecords: number; existingContacts: number; updatedContacts: number; newContacts: number;
  newGroups: number; newShoppings: number; newOrganizations: number; updatedOrganizations: number;
  existingOrganizations: number; newContactTypes: number; newOrganizationTypes: number; errorLines: number; emptyLines: number;
}
export interface RegistrationPlan {
  rows: ReviewRow[]; operations: Operation[]; dependencies: [string, unknown][]; summary: ImportSummary;
}
const nameKey = (value?: string | null) => normalizeStoreName(value) ?? '';
const text = (value?: string) => (value ?? '').normalize('NFC').trim().replace(/\s+/gu, ' ');
const sameId = (left?: string | null, right?: string | null) => (left ?? '').toLowerCase() === (right ?? '').toLowerCase();

/** Pure planning: no repository saves, generated database IDs, or message operations. */
export function planRegistrations(input: RegistrationRow[], catalog: Catalog, options: ImportOptions = {}): RegistrationPlan {
  const types = catalog.organizationTypes.map(item => ({ ...item }));
  const organizations = catalog.organizations.map(item => ({ ...item }));
  const roles = catalog.contactTypes.map(item => ({ ...item }));
  const operations = new Map<string, Operation>();
  const dependencies = new Map<string, unknown>();
  const usedOrganizations = new Set<string>();
  const organizationForRow = new Map<number, OrganizationRecord | null>();
  const intent = new Map<string, Map<string, { value: string; row: number }>>();
  const plannedContacts = new Map<string, ContactRecord>();
  const plannedPhones = new Map<string, string>();
  const organizationDeclarations = new Map<string, { value: boolean; row: number }>();
  const rows: ReviewRow[] = input.map((values, index) => ({ row: index + 2, values: { ...values }, action: 'existing', actions: [], issues: [] }));
  const originalOrganizations = new Map(catalog.organizations.map(item => [item.id, item]));
  const organizationsByName = new Map<string, OrganizationRecord[]>();
  const organizationsById = new Map(organizations.map(item => [item.id.toLowerCase(), item]));
  for (const item of organizations) organizationsByName.set(nameKey(item.name), [...(organizationsByName.get(nameKey(item.name)) ?? []), item]);
  const contactsByPhone = new Map<string, ContactRecord[]>();
  for (const item of catalog.contacts) {
    const phone = normalizeContactPhone(item.phone).normalizedPhone;
    if (phone) contactsByPhone.set(phone, [...(contactsByPhone.get(phone) ?? []), item]);
  }
  function depend(kind: EntityKind, value: Named | OrganizationRecord | ContactRecord) {
    if (!value.id.startsWith('new:')) dependencies.set(`${kind}:${value.id}`, { ...value });
  }
  function dependOrganization(organization: OrganizationRecord) {
    const original = originalOrganizations.get(organization.id);
    if (original) depend('organization', original);
    const type = catalog.organizationTypes.find(type => sameId(type.id, organization.organizationTypeId));
    if (type) depend('organizationType', type);
  }
  function issue(row: ReviewRow, message: string): never { throw new Error(message); }
  function structuralType(role: 'group' | 'shopping', row: ReviewRow): Named {
    const matches = types.filter(type => organizationRole(type.name) === role);
    const active = matches.filter(type => type.isActive);
    if (active.length > 1) return issue(row, `Há mais de um tipo configurado para ${role === 'group' ? 'grupo' : 'shopping'}. Revise os tipos antes de importar.`);
    if (active.length === 1) { depend('organizationType', active[0]); return active[0]; }
    if (matches.length) return issue(row, `O tipo de ${role === 'group' ? 'grupo' : 'shopping'} está inativo. Revise o cadastro.`);
    const type = { id: `new:organizationType:${role}`, name: role === 'group' ? 'Grupo empresarial' : 'Shopping', isActive: true };
    types.push(type);
    operations.set(type.id, { kind: 'organizationType', action: 'create', key: type.id, data: { name: type.name, isActive: true } });
    row.actions.push(`Criar tipo de organização “${type.name}”`);
    return type;
  }
  function groupAncestor(organization: OrganizationRecord, recordUsage = false): OrganizationRecord | null {
    const visited = new Set<string>(); let current: OrganizationRecord | undefined = organization;
    while (current) {
      if (visited.has(current.id)) throw new Error('A organização possui um ciclo na hierarquia. Revise o cadastro.');
      visited.add(current.id);
      dependOrganization(current);
      if (recordUsage && !current.id.startsWith('new:')) usedOrganizations.add(current.id);
      const type = types.find(type => sameId(type.id, current!.organizationTypeId));
      if (organizationRole(type?.name) === 'group') {
        if (current.parentOrganizationId) throw new Error('O grupo possui uma organização pai incompatível. Revise a hierarquia.');
        return current;
      }
      if (current.parentOrganizationId && !organizationsById.has(current.parentOrganizationId.toLowerCase())) throw new Error('A organização pai não foi encontrada. Revise a hierarquia.');
      current = current.parentOrganizationId ? organizationsById.get(current.parentOrganizationId.toLowerCase()) : undefined;
    }
    return null;
  }
  function createOrganization(name: string, type: Named, parent: OrganizationRecord | null, row: ReviewRow): OrganizationRecord {
    const key = `new:organization:${JSON.stringify([parent?.id ?? '', type.id, nameKey(name)])}`;
    const organization = { id: key, name, organizationTypeId: type.id, parentOrganizationId: parent?.id ?? null, isActive: true };
    organizations.push(organization);
    organizationsById.set(organization.id.toLowerCase(), organization);
    organizationsByName.set(nameKey(name), [...(organizationsByName.get(nameKey(name)) ?? []), organization]);
    operations.set(key, { kind: 'organization', action: 'create', key, data: { name, organizationTypeId: type.id, parentOrganizationId: parent?.id ?? null, isActive: true } });
    row.action = 'new';
    row.actions.push(`Criar ${organizationRole(type.name) === 'group' ? 'grupo' : organizationRole(type.name) === 'shopping' ? 'shopping' : type.name.toLocaleLowerCase('pt-BR')} “${name}”${parent ? ` no grupo “${parent.name}”` : ''}`);
    return organization;
  }
  function resolveOrganization(row: ReviewRow): OrganizationRecord | null {
    const groupName = text(row.values.Grupo), organizationName = text(row.values['Organização / Shopping']);
    let group: OrganizationRecord | null = null;
    if (groupName) {
      const matches = (organizationsByName.get(nameKey(groupName)) ?? []).filter(item => organizationRole(types.find(type => sameId(type.id, item.organizationTypeId))?.name) === 'group');
      if (matches.length > 1) return issue(row, `Grupo “${groupName}” é ambíguo. Há cadastros com o mesmo nome.`);
      if (!matches.length && (organizationsByName.get(nameKey(groupName)) ?? []).some(item => !item.parentOrganizationId))
        return issue(row, `O nome “${groupName}” já existe como organização de outro tipo. Revise a classificação antes de criar um grupo.`);
      group = matches[0] ?? createOrganization(groupName, structuralType('group', row), null, row);
      if (group.parentOrganizationId) return issue(row, `O grupo “${groupName}” possui uma hierarquia incompatível.`);
      dependOrganization(group);
      if (!group.id.startsWith('new:')) usedOrganizations.add(group.id);
      if (matches.length) row.actions.push(`Reutilizar grupo “${group.name}”${group.id.startsWith('new:') ? ' previsto neste lote' : ''}`);
    }
    if (!organizationName) return group;
    let matches = organizationsByName.get(nameKey(organizationName)) ?? [];
    if (group) matches = matches.filter(item => item.id !== group.id && sameId(groupAncestor(item)?.id, group.id));
    if (matches.length > 1) return issue(row, `Organização “${organizationName}” é ambígua${group ? ` no grupo “${group.name}”` : '; informe o grupo ou revise os nomes'}.`);
    if (matches.length) {
      const organization = matches[0], ancestor = groupAncestor(organization, true);
      dependOrganization(organization);
      row.actions.push(`Reutilizar organização “${organization.name}”${ancestor ? ` do grupo “${ancestor.name}”` : ' sem grupo'}${organization.id.startsWith('new:') ? ' prevista neste lote' : ''}`);
      return organization;
    }
    let type: Named;
    if (group) type = structuralType('shopping', row);
    else {
      const selected = types.find(item => sameId(item.id, options.standaloneOrganizationTypeId));
      if (!selected || !selected.isActive || organizationRole(selected.name) !== null)
        return issue(row, `A organização nova “${organizationName}” não tem grupo. Escolha um tipo configurado para novas organizações sem grupo.`);
      type = selected; depend('organizationType', type);
    }
    return createOrganization(organizationName, type, group, row);
  }
  function declare(identity: string, field: string, value: string, row: ReviewRow) {
    const fields = intent.get(identity) ?? new Map<string, { value: string; row: number }>();
    const previous = fields.get(field);
    if (previous && previous.value !== value) return issue(row, `As linhas ${previous.row} e ${row.row} propõem valores diferentes para ${field} do mesmo contato.`);
    fields.set(field, { value, row: row.row }); intent.set(identity, fields);
  }
  // Validate cells first. A line containing only organizational data never becomes a contact.
  for (const row of rows) {
    const limits: Record<string, number> = { Grupo: 150, 'Organização / Shopping': 150, Loja: 150, Responsável: 150, WhatsApp: 30, 'Tipo de contato': 100, 'E-mail': 200, Ativo: 10 };
    for (const [column, limit] of Object.entries(limits)) if (text(row.values[column]).length > limit) row.issues.push(`${column}: máximo de ${limit} caracteres.`);
    const values = REGISTRATION_COLUMNS.map(column => text(row.values[column]));
    if (!values.some(Boolean)) { row.action = 'empty'; continue; }
    const contactLine = ['Responsável', 'WhatsApp', 'Tipo de contato', 'E-mail', 'Loja'].some(column => text(row.values[column]));
    if (contactLine) {
      for (const column of ['Responsável', 'WhatsApp', 'Tipo de contato']) if (!text(row.values[column])) row.issues.push(`Informe ${column} para cadastrar um contato.`);
      if (text(row.values.WhatsApp) && !normalizeContactPhone(text(row.values.WhatsApp)).normalizedPhone) row.issues.push('WhatsApp inválido. Informe DDD e número ou formato internacional.');
      if (text(row.values['E-mail']) && !isEmail(text(row.values['E-mail']))) row.issues.push('E-mail inválido.');
    } else if (!text(row.values.Grupo) && !text(row.values['Organização / Shopping'])) row.issues.push('Informe um grupo, uma organização ou os dados do contato.');
    if (!['', 'sim', 'não', 'nao', 'true', 'false', '1', '0'].includes(nameKey(row.values.Ativo))) row.issues.push('Ativo deve ser Sim ou Não.');
    if (row.issues.length) { row.action = 'error'; continue; }
    try {
      const organization = resolveOrganization(row);
      organizationForRow.set(row.row, organization);
      if (!contactLine && organization && text(row.values.Ativo)) {
        const value = !['não', 'nao', 'false', '0'].includes(nameKey(row.values.Ativo));
        const previous = organizationDeclarations.get(organization.id);
        if (previous && previous.value !== value) issue(row, `As linhas ${previous.row} e ${row.row} propõem situações diferentes para a mesma organização.`);
        organizationDeclarations.set(organization.id, { value, row: row.row });
        if (organization.isActive !== value) {
          organization.isActive = value;
          const operation = operations.get(organization.id);
          if (operation?.action === 'create') operation.data.isActive = value;
          else operations.set(organization.id, { kind: 'organization', action: 'update', key: organization.id, data: { isActive: value } });
          if (row.action !== 'new') row.action = 'update';
          row.actions.push(`${value ? 'Ativar' : 'Inativar'} organização “${organization.name}”`);
        }
      }
    } catch (error) { row.issues.push((error as Error).message); row.action = 'error'; }
  }
  // Resolve contacts after organizational status declarations, independently of spreadsheet order.
  for (const row of rows) {
    if (row.action === 'error' || row.action === 'empty' || !text(row.values.WhatsApp)) continue;
    try {
      const organization = organizationForRow.get(row.row) ?? null;
      const phone = normalizeContactPhone(text(row.values.WhatsApp)).normalizedPhone!;
      const store = text(row.values.Loja) || null;
      const identity = JSON.stringify([phone, organization?.id ?? '', nameKey(store)]);
      const candidates = contactsByPhone.get(phone) ?? [];
      const exact = candidates.filter(contact => sameId(contact.organizationId, organization?.id) && nameKey(contact.storeName) === nameKey(store));
      if (exact.length > 1) issue(row, 'Há mais de um contato com esse WhatsApp e os mesmos vínculos. Revise o cadastro.');
      if (!exact.length && candidates.length) issue(row, 'WhatsApp já cadastrado com outra organização ou loja. O vínculo não será alterado nem será criado um contato duplicado.');
      const existing = exact[0];
      if (!existing && plannedPhones.has(phone) && plannedPhones.get(phone) !== identity)
        issue(row, 'O mesmo WhatsApp aparece neste lote com organizações ou lojas diferentes. Revise os vínculos antes de importar.');
      if (existing) depend('contact', existing);
      if (!existing && organization) {
        const ancestor = groupAncestor(organization, true);
        const type = types.find(type => sameId(type.id, organization.organizationTypeId));
        if (!organization.isActive || !type?.isActive || (ancestor && (!ancestor.isActive || !types.find(type => sameId(type.id, ancestor.organizationTypeId))?.isActive)))
          issue(row, 'A organização, seu tipo ou grupo está inativo. Revise antes de vincular um novo contato.');
      }
      const roleName = text(row.values['Tipo de contato']);
      const matchingRoles = roles.filter(role => nameKey(role.name) === nameKey(roleName));
      if (matchingRoles.length > 1) issue(row, `Tipo de contato “${roleName}” é ambíguo. Revise os cadastros.`);
      let role = matchingRoles[0];
      if (role && !role.isActive && !sameId(existing?.contactTypeId, role.id)) issue(row, `Tipo de contato “${roleName}” está inativo.`);
      if (!role) {
        role = { id: `new:contactType:${nameKey(roleName)}`, name: roleName, isActive: true };
        roles.push(role); operations.set(role.id, { kind: 'contactType', action: 'create', key: role.id, data: { name: role.name, isActive: true } });
        row.actions.push(`Criar tipo de contato “${role.name}”`);
      } else { depend('contactType', role); row.actions.push(`Reutilizar tipo de contato “${role.name}”`); }
      declare(identity, 'Responsável', nameKey(row.values.Responsável), row);
      declare(identity, 'Tipo de contato', role.id, row);
      if (text(row.values['E-mail'])) declare(identity, 'E-mail', text(row.values['E-mail']).toLowerCase(), row);
      if (text(row.values.Ativo)) declare(identity, 'Ativo', String(!['não', 'nao', 'false', '0'].includes(nameKey(row.values.Ativo))), row);
      const isActive = text(row.values.Ativo) ? !['não', 'nao', 'false', '0'].includes(nameKey(row.values.Ativo)) : existing?.isActive ?? true;
      const previousPlanned = plannedContacts.get(identity);
      if (!existing && !previousPlanned) {
        const key = `new:contact:${identity}`;
        const data = { contactName: text(row.values.Responsável), phone: text(row.values.WhatsApp), email: text(row.values['E-mail']) || null, organizationId: organization?.id ?? null, storeName: store, contactTypeId: role.id, isActive };
        operations.set(key, { kind: 'contact', action: 'create', key, data });
        plannedContacts.set(identity, { id: key, ...data });
        plannedPhones.set(phone, identity);
        row.action = 'new'; row.actions.push(`Criar contato “${data.contactName}”`);
      } else {
        const target = existing ?? previousPlanned!;
        const operation = operations.get(target.id);
        const changes: Operation['data'] = { ...(operation?.data ?? {}) };
        if (nameKey(target.contactName) !== nameKey(row.values.Responsável)) changes.contactName = text(row.values.Responsável);
        if (!sameId(target.contactTypeId, role.id)) changes.contactTypeId = role.id;
        if (text(row.values['E-mail']) && (target.email ?? '').trim().toLowerCase() !== text(row.values['E-mail']).toLowerCase()) changes.email = text(row.values['E-mail']);
        if (text(row.values.Ativo) && target.isActive !== isActive) changes.isActive = isActive;
        if (Object.keys(changes).length && existing) {
          operations.set(existing.id, { kind: 'contact', action: 'update', key: existing.id, data: changes });
          const labels: Record<string, string> = { contactName: 'responsável', contactTypeId: 'tipo de contato', email: 'e-mail', isActive: 'situação' };
          row.action = 'update'; row.actions.push(`Atualizar contato “${existing.contactName}”: ${Object.keys(changes).map(field => labels[field] ?? field).join(', ')}`);
        } else {
          if (previousPlanned && operation?.action === 'create') Object.assign(operation.data, changes);
          row.actions.push(`Contato “${target.contactName}” já ${existing ? 'cadastrado; preservar vínculos e telefone' : 'previsto neste lote; não duplicar'}`);
        }
      }
    } catch (error) { row.issues.push((error as Error).message); row.action = 'error'; }
  }
  // Organization creation must also honor the final parent status of this batch.
  for (const operation of operations.values()) {
    if (operation.kind !== 'organization' || operation.action !== 'create' || !operation.data.parentOrganizationId) continue;
    const parent = organizations.find(item => sameId(item.id, String(operation.data.parentOrganizationId)));
    const parentType = types.find(type => sameId(type.id, parent?.organizationTypeId));
    if (!parent?.isActive || !parentType?.isActive) {
      for (const row of rows) if (organizationForRow.get(row.row)?.id === operation.key) { row.issues.push('Não é possível criar organização em grupo inativo.'); row.action = 'error'; }
    }
  }
  const ops = [...operations.values()];
  const count = (kind: EntityKind, action: Operation['action']) => ops.filter(op => op.kind === kind && op.action === action).length;
  const newGroups = ops.filter(op => op.kind === 'organization' && op.action === 'create' && organizationRole(types.find(type => sameId(type.id, String(op.data.organizationTypeId)))?.name) === 'group').length;
  const newShoppings = ops.filter(op => op.kind === 'organization' && op.action === 'create' && organizationRole(types.find(type => sameId(type.id, String(op.data.organizationTypeId)))?.name) === 'shopping').length;
  return { rows, operations: ops, dependencies: [...dependencies.entries()].sort(([a], [b]) => a.localeCompare(b)), summary: {
    newRecords: ops.filter(op => op.action === 'create').length,
    newContacts: count('contact', 'create'), updatedContacts: count('contact', 'update'), existingContacts: [...dependencies.keys()].filter(key => key.startsWith('contact:')).length - count('contact', 'update'),
    newGroups, newShoppings, newOrganizations: count('organization', 'create') - newGroups - newShoppings, updatedOrganizations: count('organization', 'update'),
    existingOrganizations: usedOrganizations.size - count('organization', 'update'),
    newContactTypes: count('contactType', 'create'), newOrganizationTypes: count('organizationType', 'create'), errorLines: rows.filter(row => row.issues.length).length, emptyLines: rows.filter(row => row.action === 'empty').length,
  } };
}
