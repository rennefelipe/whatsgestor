"use client";

import { useEffect, useState, type FormEvent } from "react";
import {
  createContact,
  updateContact,
} from "@/services/api/contacts";
import type {
  Contact,
  ContactPayload,
  ContactType,
  Organization,
} from "@/types/api";
import { Icon } from "../icons";

interface ContactFormModalProps {
  contact: Contact | null;
  organizations: Organization[];
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
        await updateContact(contact.id, payload);
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
            <div className="form-grid">
              <div className="form-field">
                <label htmlFor="organizationId">
                  Organização <span>· opcional</span>
                </label>
                <select
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
                  {organizations.map((organization) => (
                    <option key={organization.id} value={organization.id}>
                      {organization.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-field">
                <label htmlFor="contactTypeId">Tipo de contato *</label>
                <select
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
                        : "Selecione um tipo"}
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
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="form-field">
              <label htmlFor="storeName">
                Loja <span>· opcional</span>
              </label>
              <input
                id="storeName"
                maxLength={150}
                onChange={(event) => setStoreName(event.target.value)}
                placeholder="Nome da loja"
                value={storeName}
              />
            </div>

            <div className="form-field">
              <label htmlFor="contactName">Nome do responsável *</label>
              <input
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
                <label htmlFor="phone">Telefone *</label>
                <input
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
                <input
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
              {isSaving ? "Salvando..." : contact ? "Salvar alterações" : "Salvar contato"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
