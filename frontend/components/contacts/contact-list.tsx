import type { Contact, ContactDisplaySetting } from "@/types/api";
import { Icon } from "../icons";
import { ProfileAvatar } from "../profile-avatar";

interface ContactListProps {
  contacts: Contact[];
  settings: ContactDisplaySetting[];
  busyContactId: string | null;
  onEdit: (contact: Contact) => void;
  onToggleActive: (contact: Contact) => void;
}

const fieldLabels: Record<string, string> = {
  group: "Grupo",
  shopping: "Organização",
  store: "Loja",
  contactType: "Tipo",
  contactName: "Contato",
};

function getFieldValue(contact: Contact, fieldKey: string): string | null {
  const valueByKey: Record<string, string | null | undefined> = {
    group: contact.organization?.parentOrganization?.name,
    shopping: contact.organization?.name,
    store: contact.storeName,
    contactType: contact.contactType?.name,
    contactName: contact.contactName,
  };
  return valueByKey[fieldKey]?.trim() || null;
}

export function ContactList({
  contacts,
  settings,
  busyContactId,
  onEdit,
  onToggleActive,
}: ContactListProps) {
  const identitySettings = settings
    .filter((setting) => setting.isVisible)
    .sort((left, right) => left.displayOrder - right.displayOrder);

  return (
    <div className="table-panel">
      {contacts.length === 0 ? (
        <div className="empty-state">
          <strong>Nenhum contato encontrado</strong>
          <p>Experimente ajustar os filtros ou cadastrar um novo contato.</p>
        </div>
      ) : (
        <div className="contact-table-scroll">
          <table className="contact-table">
            <thead>
              <tr>
                <th scope="col">Identificação</th>
                <th scope="col">Telefone</th>
                <th scope="col">E-mail</th>
                <th scope="col">Organização</th>
                <th scope="col">Tipo</th>
                <th scope="col">Situação</th>
                <th scope="col">
                  <span className="sr-only">Ações</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {contacts.map((contact) => {
                const identity = identitySettings
                  .map((setting) => ({
                    key: setting.fieldKey,
                    value: getFieldValue(contact, setting.fieldKey),
                  }))
                  .filter((item): item is { key: string; value: string } =>
                    Boolean(item.value),
                  );
                const identityTitle = identity[0]?.value ?? "Sem identificação";

                return (
                  <tr key={contact.id}>
                    <td className="identity-cell">
                      <div className="contact-identity-row">
                        <ProfileAvatar
                          name={contact.contactName}
                          contactId={contact.id}
                        />
                        <div className="contact-identity-copy">
                          <div className="identity-title" title={identityTitle}>
                            {identityTitle}
                          </div>
                          <div className="identity-tags">
                            {identity
                              .filter((item) => item.value !== identityTitle)
                              .map((item) => (
                                <span
                                  className="identity-tag"
                                  key={`${item.key}-${item.value}`}
                                  title={`${fieldLabels[item.key] ?? item.key}: ${item.value}`}
                                >
                                  {fieldLabels[item.key] ?? item.key}:{" "}
                                  {item.value}
                                </span>
                              ))}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <div className="cell-primary">{contact.phone}</div>
                    </td>
                    <td>
                      <div className="cell-primary" title={contact.email ?? ""}>
                        {contact.email || "—"}
                      </div>
                    </td>
                    <td>
                      <div
                        className="cell-primary"
                        title={contact.organization?.name ?? ""}
                      >
                        {contact.organization?.name || "—"}
                      </div>
                      {contact.storeName && (
                        <div
                          className="cell-secondary"
                          title={contact.storeName}
                        >
                          {contact.storeName}
                        </div>
                      )}
                    </td>
                    <td>
                      <div className="cell-primary">
                        {contact.contactType?.name || "—"}
                      </div>
                    </td>
                    <td>
                      <span
                        className={`status-pill ${contact.isActive ? "active" : "inactive"}`}
                      >
                        {contact.isActive ? "Ativo" : "Inativo"}
                      </span>
                    </td>
                    <td>
                      <div className="row-actions">
                        <button
                          aria-label={`Editar ${contact.contactName}`}
                          className="icon-button"
                          onClick={() => onEdit(contact)}
                          title="Editar contato"
                          type="button"
                        >
                          <Icon name="edit" size={16} />
                        </button>
                        <button
                          aria-label={`${contact.isActive ? "Inativar" : "Ativar"} ${contact.contactName}`}
                          className="icon-button"
                          disabled={busyContactId === contact.id}
                          onClick={() => onToggleActive(contact)}
                          title={
                            contact.isActive
                              ? "Inativar contato"
                              : "Ativar contato"
                          }
                          type="button"
                        >
                          <Icon
                            name={contact.isActive ? "deactivate" : "activate"}
                            size={16}
                          />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
