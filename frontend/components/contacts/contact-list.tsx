import type { Contact, ContactDisplaySetting } from "@/types/api";
import { Icon } from "../icons";
import { ProfileAvatar } from "../profile-avatar";

interface ContactListProps {
  readOnly?: boolean;
  contacts: Contact[];
  settings: ContactDisplaySetting[];
  busyContactId: string | null;
  onEdit: (contact: Contact) => void;
  onToggleActive: (contact: Contact) => void;
  onPreferences?: (contact: Contact) => void;
}

export function ContactList({
  readOnly = false,
  contacts,
  settings,
  busyContactId,
  onEdit,
  onToggleActive,
  onPreferences,
}: ContactListProps) {
  const visible = (field: string) =>
    settings.find((setting) => setting.fieldKey === field)?.isVisible ?? true;
  const order = (field: string, fallback: number) =>
    settings.find((setting) => setting.fieldKey === field)?.displayOrder ??
    fallback;
  // Responsible person stays primary; optional identification settings retain
  // their visibility and order without repeating each value in multiple cells.
  const columns = [
    {
      key: "context",
      label: "Grupo / Shopping",
      shown: visible("group") || visible("shopping"),
      order: Math.min(order("group", 1), order("shopping", 2)),
    },
    {
      key: "store",
      label: "Loja",
      shown: visible("store"),
      order: order("store", 3),
    },
    {
      key: "role",
      label: "Função / Cargo",
      shown: visible("contactType"),
      order: order("contactType", 4),
    },
  ]
    .filter((column) => column.shown)
    .sort((a, b) => a.order - b.order);
  return (
    <div className="table-panel contacts-redesign">
      {contacts.length === 0 ? (
        <div className="empty-state">
          <strong>Nenhum contato encontrado</strong>
          <p>Experimente ajustar os filtros ou cadastrar um novo contato.</p>
        </div>
      ) : (
        <div className="contact-table-scroll contacts-table-scroll">
          <table className="contact-table">
            <thead>
              <tr>
                <th scope="col">Responsável</th>
                {columns.map((column) => (
                  <th scope="col" key={column.key}>
                    {column.label}
                  </th>
                ))}
                <th scope="col">WhatsApp / E-mail</th>
                <th scope="col">Ações</th>
              </tr>
            </thead>
            <tbody>
              {contacts.map((contact) => (
                <tr key={contact.id}>
                  <td className="identity-cell" data-label="Responsável">
                    <div className="contact-identity-row">
                      <ProfileAvatar
                        name={contact.contactName}
                        contactId={readOnly ? undefined : contact.id}
                      />
                      <div className="contact-identity-copy">
                        <div className="identity-title">
                          {contact.contactName}
                        </div>
                        <span
                          className={`status-pill ${contact.isActive ? "active" : "inactive"}`}
                        >
                          {contact.isActive ? "Ativo" : "Inativo"}
                        </span>
                      </div>
                    </div>
                  </td>
                  {columns.map((column) => (
                    <td key={column.key} data-label={column.label}>
                      {column.key === "context" ? (
                        <>
                          {visible("group") && (
                            <div className="cell-primary">
                              {contact.organizationContext?.group?.name ||
                                "Grupo não informado"}
                            </div>
                          )}
                          {visible("shopping") && (
                            <div className="cell-secondary">
                              {contact.organizationContext?.shopping?.name ||
                                "Shopping não informado"}
                            </div>
                          )}
                          {contact.organization &&
                            contact.organization.id !==
                              contact.organizationContext?.group?.id &&
                            contact.organization.id !==
                              contact.organizationContext?.shopping?.id && (
                              <div className="cell-secondary">
                                Organização: {contact.organization.name}
                              </div>
                            )}
                          {contact.organizationContext?.hierarchyIssue && (
                            <div className="cell-secondary">
                              {contact.organizationContext.hierarchyIssue}
                            </div>
                          )}
                        </>
                      ) : column.key === "store" ? (
                        <div className="cell-primary">
                          {contact.storeName?.trim() || "Sem loja"}
                        </div>
                      ) : (
                        <div className="cell-primary">
                          {contact.contactType?.name || "Não informada"}
                        </div>
                      )}
                    </td>
                  ))}
                  <td data-label="WhatsApp / E-mail">
                    <div className="cell-primary">{contact.phone}</div>
                    <div className="cell-secondary">
                      {contact.email || "E-mail não informado"}
                    </div>
                  </td>
                  <td data-label="Ações">
                    {readOnly ? <span>Somente consulta</span> : <div className="row-actions">
                      <button
                        aria-label={`Editar ${contact.contactName}`}
                        className="secondary-button contact-row-button"
                        onClick={() => onEdit(contact)}
                        type="button"
                      >
                        <Icon name="edit" size={14} />
                        Editar
                      </button>
                      <details className="contact-more-actions">
                        <summary className="secondary-button contact-row-button">
                          Mais ações
                        </summary>
                        <div className="contact-more-actions-body">
                          {onPreferences && (
                            <button
                              className="secondary-button contact-row-button"
                              type="button"
                              title="Restrições de envio"
                              aria-label={`Restrições de envio de ${contact.contactName}`}
                              onClick={() => onPreferences(contact)}
                            >
                              <Icon name="bulk-send" size={14} />
                              Preferências
                            </button>
                          )}
                          <button
                            aria-label={`${contact.isActive ? "Inativar" : "Ativar"} ${contact.contactName}`}
                            className="secondary-button contact-row-button"
                            disabled={busyContactId === contact.id}
                            onClick={() => onToggleActive(contact)}
                            type="button"
                          >
                            <Icon
                              name={
                                contact.isActive ? "deactivate" : "activate"
                              }
                              size={14}
                            />
                            {contact.isActive ? "Inativar" : "Ativar"}
                          </button>
                        </div>
                      </details>
                    </div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
