// Same explicit type-name vocabulary as backend/contacts/organization-context.
export function organizationRole(name?: string): "group" | "shopping" | null {
  const value = name
    ?.normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  if (value === "grupo" || value === "grupo empresarial") return "group";
  if (["shopping", "shopping center", "shopping centre"].includes(value ?? ""))
    return "shopping";
  return null;
}
