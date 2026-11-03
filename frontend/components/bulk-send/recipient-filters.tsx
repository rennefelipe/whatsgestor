import type { ContactOptions, ContactType } from "@/types/api";
import type { RecipientFilters } from "@/services/api/bulk-send";

export function RecipientFiltersForm({
  filters,
  options,
  roles,
  disabled,
  onChange,
  onApply,
}: {
  filters: RecipientFilters;
  options: ContactOptions;
  roles: ContactType[];
  disabled: boolean;
  onChange: (filters: RecipientFilters) => void;
  onApply: (filters: RecipientFilters) => void;
}) {
  const groups = [
    ...new Map(
      options.organizationContexts.flatMap((context) =>
        context.group ? [[context.group.id, context.group] as const] : [],
      ),
    ).values(),
  ];
  const shoppings = [
    ...new Map(
      options.organizationContexts
        .filter(
          (context) =>
            !filters.groupId || context.group?.id === filters.groupId,
        )
        .flatMap((context) =>
          context.shopping
            ? [
                [
                  context.shopping.id,
                  { ...context.shopping, group: context.group?.name },
                ] as const,
              ]
            : [],
        ),
    ).values(),
  ];
  return (
    <form
      className="recipient-filters"
      onSubmit={(event) => {
        event.preventDefault();
        onApply(filters);
      }}
    >
      <label>
        Grupo
        <select
          className="filter-select"
          aria-label="Grupo dos destinatários"
          disabled={disabled}
          value={filters.groupId || ""}
          onChange={(event) =>
            onChange({
              ...filters,
              groupId: event.target.value || undefined,
              shoppingId: undefined,
            })
          }
        >
          <option value="">Todos os grupos</option>
          {groups.map((group) => (
            <option key={group.id} value={group.id}>
              {group.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Shopping
        <select
          className="filter-select"
          aria-label="Shopping dos destinatários"
          disabled={disabled}
          value={filters.shoppingId || ""}
          onChange={(event) =>
            onChange({
              ...filters,
              shoppingId: event.target.value || undefined,
            })
          }
        >
          <option value="">Todos os shoppings</option>
          {shoppings.map((shopping) => (
            <option key={shopping.id} value={shopping.id}>
              {shopping.name}
              {shopping.group ? ` · ${shopping.group}` : ""}
            </option>
          ))}
        </select>
      </label>
      <label>
        Loja
        <select
          className="filter-select"
          aria-label="Loja dos destinatários"
          disabled={disabled}
          value={
            filters.withoutStore
              ? "none"
              : filters.storeName
                ? `store:${filters.storeName}`
                : ""
          }
          onChange={(event) =>
            onChange({
              ...filters,
              withoutStore: event.target.value === "none" ? true : undefined,
              storeName: event.target.value.startsWith("store:")
                ? event.target.value.slice(6)
                : undefined,
            })
          }
        >
          <option value="">Todas as lojas</option>
          <option value="none">Sem loja</option>
          {options.storeNames.map((name) => (
            <option key={name} value={`store:${name}`}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Função / Cargo
        <select
          className="filter-select"
          aria-label="Função dos destinatários"
          disabled={disabled}
          value={filters.contactTypeId || ""}
          onChange={(event) =>
            onChange({
              ...filters,
              contactTypeId: event.target.value || undefined,
            })
          }
        >
          <option value="">Todas as funções</option>
          {roles.map((role) => (
            <option key={role.id} value={role.id}>
              {role.name}
              {!role.isActive ? " (inativa)" : ""}
            </option>
          ))}
        </select>
      </label>
      <label>
        Nome do responsável
        <input
          type="search"
          aria-label="Nome do responsável dos destinatários"
          disabled={disabled}
          value={filters.contactName || ""}
          placeholder="Pesquisar responsável"
          onChange={(event) =>
            onChange({
              ...filters,
              contactName: event.target.value || undefined,
            })
          }
        />
      </label>
      <label>
        Número de WhatsApp
        <input
          type="search"
          aria-label="Número dos destinatários"
          disabled={disabled}
          value={filters.phone || ""}
          placeholder="Pesquisar número"
          onChange={(event) =>
            onChange({ ...filters, phone: event.target.value || undefined })
          }
        />
      </label>
      <div className="recipient-actions">
        <button type="submit" className="primary-button" disabled={disabled}>
          Aplicar filtros
        </button>
        <button
          type="button"
          className="secondary-button"
          disabled={disabled}
          onClick={() => {
            onChange({});
            onApply({});
          }}
        >
          Limpar filtros
        </button>
      </div>
    </form>
  );
}
