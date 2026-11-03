import type { Organization } from '@/types/api';

interface Entry { organization: Organization; depth: number }
export function organizationTreeRows(hierarchy: Entry[], filters: { search: string; status: string; typeId: string }, collapsed: ReadonlySet<string>) {
  const byId = new Map(hierarchy.map((entry, index) => [entry.organization.id.toLowerCase(), { ...entry, index }]));
  const parents = new Map<string, string>();
  const children = new Map<string, number>();
  for (const entry of byId.values()) {
    const parent = entry.organization.parentOrganizationId ? byId.get(entry.organization.parentOrganizationId.toLowerCase()) : undefined;
    // The existing hierarchy traversal breaks cycles/orphan links without changing records.
    if (parent && parent.index < entry.index && parent.depth < entry.depth) {
      parents.set(entry.organization.id, parent.organization.id);
      children.set(parent.organization.id, (children.get(parent.organization.id) ?? 0) + 1);
    }
  }
  const ancestors = (id: string): string[] => {
    const values: string[] = []; let parent = parents.get(id);
    while (parent) { values.push(parent); parent = parents.get(parent); }
    return values;
  };
  const normalize = (value: string) => value.normalize('NFC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('pt-BR');
  const search = normalize(filters.search);
  const matching = new Set(hierarchy.filter(({ organization }) => {
    const context = ancestors(organization.id).map(id => byId.get(id.toLowerCase())!.organization.name);
    return (!search || [organization.name, organization.organizationType?.name ?? '', ...context].some(value => normalize(value).includes(search)))
      && (!filters.status || String(organization.isActive) === filters.status)
      && (!filters.typeId || organization.organizationTypeId === filters.typeId);
  }).map(entry => entry.organization.id));
  const included = new Set(matching);
  for (const id of matching) for (const ancestor of ancestors(id)) included.add(ancestor);
  return {
    matchCount: matching.size, parentIds: [...children.keys()],
    items: hierarchy.filter(({ organization }) => included.has(organization.id) && !ancestors(organization.id).some(id => collapsed.has(id))).map(entry => ({
      ...entry, childCount: children.get(entry.organization.id) ?? 0,
      isExpanded: !collapsed.has(entry.organization.id), contextOnly: !matching.has(entry.organization.id),
    })),
  };
}
