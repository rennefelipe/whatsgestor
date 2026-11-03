"use client";

import { FullTextInput } from "../full-text-input";

import { FullTextSelect } from "../full-text-select";

import { useEffect, useState, type FormEvent } from "react";
import { createContact, updateContact } from "@/services/api/contacts";
import type {
  Contact,
  ContactPayload,
  ContactType,
  Organization,
  OrganizationContext,
} from "@/types/api";
import { Icon } from "../icons";

interface ContactFormModalProps {
  contact: Contact | null;
  organizations: Organization[];
  organizationContexts: OrganizationContext[];
  contactTypes: ContactType[];
  isLoadingOptions: boolean;
  optionsError: string;
  onClose: () => void;
  onRetryOptions: () => void;
  onSaved: () => Promise<void>;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Não foi possível salvar o contato.";
}

export function ContactFormModal({
  contact,
  organizations,
  organizationContexts,
  contactTypes,
  isLoadingOptions,
  optionsError,
  onClose,
  onRetryOptions,
  onSaved,
}: ContactFormModalProps) {
  const [organizationId, setOrganizationId] = useState(
    contact?.organizationId ?? "",
  );
  const [contactTypeId, setContactTypeId] = useState(
    contact?.contactTypeId ?? "",
  );
  const [storeName, setStoreName] = useState(contact?.storeName ?? "");
  const [contactName, setContactName] = useState(contact?.contactName ?? "");
  const [phone, setPhone] = useState(contact?.phone ?? "");
  const [email, setEmail] = useState(contact?.email ?? "");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const selectedOrganization = organizations.find(
    (organization) => organization.id === organizationId,
  );
  const context = organizationContexts.find(
    (item) => item.organizationId === organizationId,
  );

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !isSaving) onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isSaving, onClose]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsSaving(true);
    const payload: ContactPayload = {
      organizationId: organizationId || null,
      contactTypeId,
      storeName: storeName.trim() || null,
      contactName: contactName.trim(),
      phone: phone.trim(),
      email: email.trim() || null,
    };
    try {
      if (contact) {
        // Preserve unchanged legacy values (including phone formatting and nulls).
        const original = {
          organizationId: contact.organizationId ?? "",
          contactTypeId: contact.contactTypeId,
          storeName: contact.storeName ?? "",
          contactName: contact.contactName,
          phone: contact.phone,
          email: contact.email ?? "",
        };
        const current = {
          organizationId,
          contactTypeId,
          storeName,
          contactName,
          phone,
          email,
        };
        const changes: Partial<ContactPayload> = {};
        for (const key of Object.keys(current) as (keyof ContactPayload)[]) {
          if (current[key] !== original[key])
            Object.assign(changes, { [key]: payload[key] });
        }
        if (Object.keys(changes).length)
          await updateContact(contact.id, changes);
      } else {
        await createContact(payload);
      }
      await onSaved();
    } catch (saveError) {
      setError(getErrorMessage(saveError));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isSaving) onClose();
      }}
    >
      <section
        aria-labelledby="contact-form-title"
        aria-modal="true"
        className="modal"
        role="dialog"
      >
        <header className="modal-header">
          <div>
            <h2 id="contact-form-title">
              {contact ? "Editar contato" : "Novo contato"}
            </h2>
            <p>Preencha os dados para manter sua lista atualizada.</p>
          </div>
          <button
            aria-label="Fechar formulário"
            className="icon-button"
            disabled={isSaving}
            onClick={onClose}
            type="button"
          >
            <Icon name="close" size={18} />
          </button>
        </header>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {error && (
              <div className="form-error" role="alert">
                {error}
              </div>
            )}
            {optionsError && (
              <div className="form-error" role="alert">
                <span>
                  Não foi possível carregar as opções de organização e tipo de
                  contato. {optionsError}
                </span>
                <button
                  className="secondary-button options-retry-button"
                  disabled={isLoadingOptions}
                  onClick={onRetryOptions}
                  type="button"
                >
                  {isLoadingOptions ? "Carregando..." : "Tentar novamente"}
                </button>
              </div>
            )}
            <fieldset className="form-section"><legend>Dados do contato</legend>
            <div className="form-field">
              <label htmlFor="contactName">Nome do responsável *</label>
              <FullTextInput
                autoFocus
                id="contactName"
                maxLength={150}
                onChange={(event) => setContactName(event.target.value)}
                placeholder="Nome completo"
                required
                value={contactName}
              />
            </div>

            <div className="form-grid">
              <div className="form-field">
                <label htmlFor="phone">Número de WhatsApp *</label>
                <FullTextInput
                  id="phone"
                  maxLength={30}
                  onChange={(event) => setPhone(event.target.value)}
                  placeholder="(00) 00000-0000"
                  required
                  value={phone}
                />
              </div>
              <div className="form-field">
                <label htmlFor="email">
                  E-mail <span>· opcional</span>
                </label>
                <FullTextInput
                  autoComplete="email"
                  id="email"
                  maxLength={200}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="nome@empresa.com"
                  type="email"
                  value={email}
                />
              </div>
            </div>
              <div className="form-field">
                <label htmlFor="contactTypeId">Função / Cargo *</label>
                <FullTextSelect
                  disabled={isLoadingOptions || Boolean(optionsError)}
                  id="contactTypeId"
                  onChange={(event) => setContactTypeId(event.target.value)}
                  required
                  value={contactTypeId}
                >
                  <option value="">
                    {isLoadingOptions
                      ? "Carregando tipos..."
                      : optionsError
                        ? "Opções indisponíveis"
                        : "Selecione uma função / cargo"}
                  </option>
                  {!isLoadingOptions &&
                    !optionsError &&
                    contactTypes.length === 0 && (
                      <option disabled value="">
                        Nenhum tipo ativo cadastrado
                      </option>
                    )}
                  {contactTypes.map((type) => (
                    <option key={type.id} value={type.id}>
                      {type.name}
                      {!type.isActive ? " (inativa — vínculo atual)" : ""}
                    </option>
                  ))}
                </FullTextSelect>
              </div>
            </fieldset>
            <fieldset className="form-section"><legend>Organização</legend>
              <div className="form-field">
                <label htmlFor="organizationId">
                  Organização vinculada <span>· opcional</span>
                </label>
                <FullTextSelect
                  disabled={isLoadingOptions || Boolean(optionsError)}
                  id="organizationId"
                  onChange={(event) => setOrganizationId(event.target.value)}
                  value={organizationId}
                >
                  <option value="">
                    {isLoadingOptions
                      ? "Carregando organizações..."
                      : optionsError
                        ? "Opções indisponíveis"
                        : "Sem organização"}
                  </option>
                  {!isLoadingOptions &&
                    !optionsError &&
                    organizations.length === 0 && (
                      <option disabled value="">
                        Nenhuma organização ativa cadastrada
                      </option>
                    )}
                  {organizations.map((organization) => {
                    const group = organizationContexts.find(
                      (item) => item.organizationId === organization.id,
                    )?.group;
                    return (
                      <option key={organization.id} value={organization.id}>
                        {organization.name}
                        {organization.organizationType?.name
                          ? ` · ${organization.organizationType.name}`
                          : ""}
                        {group && group.id !== organization.id
                          ? ` · ${group.name}`
                          : ""}
                        {!organization.isActive
                          ? " (inativa — vínculo atual)"
                          : ""}
                      </option>
                    );
                  })}
                </FullTextSelect>
              </div>

            {organizationId && <div className="organization-context-card" role="status">
              <strong>{context?.organizationType || selectedOrganization?.organizationType?.name || "Organização"}</strong>
              <span>{[context?.group?.name, context?.shopping?.name, selectedOrganization?.name].filter((name, index, values) => name && values.indexOf(name) === index).join(" › ")}</span>
            </div>}
            {context?.hierarchyIssue && (
              <p className="form-error" role="status">
                {context.hierarchyIssue}. O vínculo atual será preservado; grupo
                e shopping não foram atribuídos.
              </p>
            )}

            </fieldset>
            <fieldset className="form-section"><legend>Loja</legend>
            <div className="form-field">
              <label htmlFor="storeName">
                Nome da loja <span>· opcional</span>
              </label>
              <FullTextInput
                id="storeName"
                maxLength={150}
                onChange={(event) => setStoreName(event.target.value)}
                placeholder="Nome da loja"
                value={storeName}
              />
            </div>

            </fieldset>
          </div>

          <footer className="modal-footer">
            <button
              className="secondary-button"
              disabled={isSaving}
              onClick={onClose}
              type="button"
            >
              Cancelar
            </button>
            <button
              className="primary-button"
              disabled={isSaving || isLoadingOptions || Boolean(optionsError)}
              type="submit"
            >
              {isSaving
                ? "Salvando..."
                : contact
                  ? "Salvar alterações"
                  : "Salvar contato"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
