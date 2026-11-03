import type { Organization } from '../organizations/entities/organization.entity';

export function organizationRole(name?: string): 'group' | 'shopping' | null {
  const value = name
    ?.normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  if (value === 'grupo' || value === 'grupo empresarial') return 'group';
  if (
    value === 'shopping' ||
    value === 'shopping center' ||
    value === 'shopping centre'
  )
    return 'shopping';
  return null;
}

export interface OrganizationContext {
  organizationId: string;
  organizationType: string | null;
  group: { id: string; name: string } | null;
  shopping: { id: string; name: string } | null;
  hierarchyIssue: string | null;
}

// Only explicitly recognized types establish context. Unknown types remain intact.
export function organizationContexts(
  organizations: Organization[],
): OrganizationContext[] {
  const byId = new Map(
    organizations.map((organization) => [
      organization.id.toLowerCase(),
      organization,
    ]),
  );
  return organizations.map((organization) => {
    const context: OrganizationContext = {
      organizationId: organization.id,
      organizationType: organization.organizationType?.name ?? null,
      group: null,
      shopping: null,
      hierarchyIssue: null,
    };
    const visited = new Set<string>();
    let current: Organization | undefined = organization;
    while (current) {
      const id = current.id.toLowerCase();
      if (visited.has(id)) {
        context.hierarchyIssue = 'Hierarquia com ciclo';
        break;
      }
      visited.add(id);
      const role = organizationRole(current.organizationType?.name);
      if (role && (context[role] || (role === 'shopping' && context.group))) {
        context.hierarchyIssue = 'Hierarquia ambígua';
        break;
      }
      if (role) context[role] = { id: current.id, name: current.name };
      if (!current.parentOrganizationId) break;
      current = byId.get(current.parentOrganizationId.toLowerCase());
      if (!current) context.hierarchyIssue = 'Organização pai não encontrada';
    }
    if (context.hierarchyIssue) {
      context.group = null;
      context.shopping = null;
    }
    return context;
  });
}
