"use client";

import { useCallback, useEffect, useState } from "react";
import {
  getContactDisplaySettings,
  getContactTypes,
  getContacts,
  getOrganizations,
  updateContactActive,
} from "@/services/api/contacts";
import type {
  Contact,
  ContactDisplaySetting,
  ContactType,
  Organization,
} from "@/types/api";
import { AppShell } from "../app-shell";
import type { Section } from "../app-shell";
import { Icon } from "../icons";
import { SettingsContent } from "../settings/settings-screen";
import { WhatsappConnectionsScreen } from "../whatsapp/whatsapp-connections-screen";
import { WhatsappConversationsScreen } from "../whatsapp/whatsapp-conversations-screen";
import { ContactFormModal } from "./contact-form-modal";
import { ContactList } from "./contact-list";

const emptyFilters = {
  organizationId: "",
  contactTypeId: "",
  isActive: "",
  search: "",
};

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Não foi possível carregar as informações.";
}

export function ContactsScreen() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [contactTypes, setContactTypes] = useState<ContactType[]>([]);
  const [displaySettings, setDisplaySettings] = useState<
    ContactDisplaySetting[]
  >([]);
  const [filters, setFilters] = useState(emptyFilters);
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [contactsError, setContactsError] = useState("");
  const [optionsError, setOptionsError] = useState("");
  const [settingsError, setSettingsError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingOptions, setIsLoadingOptions] = useState(true);
  const [optionsReloadKey, setOptionsReloadKey] = useState(0);
  const [isLoadingSettings, setIsLoadingSettings] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [busyContactId, setBusyContactId] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(
      () => setDebouncedSearch(filters.search.trim()),
      300,
    );
    return () => window.clearTimeout(timer);
  }, [filters.search]);

  useEffect(() => {
    const controller = new AbortController();

    getContacts(
      {
        organizationId: filters.organizationId,
        contactTypeId: filters.contactTypeId,
        isActive: filters.isActive,
        search: debouncedSearch,
      },
      controller.signal,
    )
      .then((result) => {
        setContacts(result);
        setContactsError("");
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setContactsError(errorMessage(error));
          setContacts([]);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });

    return () => controller.abort();
  }, [
    filters.organizationId,
    filters.contactTypeId,
    filters.isActive,
    debouncedSearch,
    reloadKey,
  ]);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      getOrganizations(controller.signal),
      getContactTypes(controller.signal),
    ])
      .then(([organizationOptions, contactTypeOptions]) => {
        setOrganizations(organizationOptions);
        setContactTypes(contactTypeOptions);
        setOptionsError("");
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setOptionsError(errorMessage(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoadingOptions(false);
      });
    return () => controller.abort();
  }, [optionsReloadKey]);

  useEffect(() => {
    const controller = new AbortController();
    getContactDisplaySettings(controller.signal)
      .then(setDisplaySettings)
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setSettingsError(errorMessage(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoadingSettings(false);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!toastMessage) return;
    const timer = window.setTimeout(() => setToastMessage(""), 3200);
    return () => window.clearTimeout(timer);
  }, [toastMessage]);

  const refreshContacts = useCallback(() => {
    setIsLoading(true);
    setContactsError("");
    setReloadKey((current) => current + 1);
  }, []);

  function refreshContactOptions() {
    setIsLoadingOptions(true);
    setOptionsError("");
    setOptionsReloadKey((current) => current + 1);
  }

  function updateFilters(
    update: (current: typeof filters) => typeof filters,
  ) {
    setIsLoading(true);
    setContactsError("");
    setFilters(update);
  }

  async function handleToggleActive(contact: Contact) {
    setBusyContactId(contact.id);
    setContactsError("");
    try {
      await updateContactActive(contact.id, !contact.isActive);
      setToastMessage(
        contact.isActive
          ? "Contato inativado com sucesso."
          : "Contato ativado com sucesso.",
      );
      refreshContacts();
    } catch (error) {
      setContactsError(errorMessage(error));
    } finally {
      setBusyContactId(null);
    }
  }

  function openCreateForm() {
    setEditingContact(null);
    refreshContactOptions();
    setIsFormOpen(true);
  }

  function openEditForm(contact: Contact) {
    setEditingContact(contact);
    refreshContactOptions();
    setIsFormOpen(true);
  }

  function closeForm() {
    setIsFormOpen(false);
    setEditingContact(null);
  }

  async function handleSaved() {
    closeForm();
    setToastMessage(
      editingContact
        ? "Contato atualizado com sucesso."
        : "Contato cadastrado com sucesso.",
    );
    refreshContacts();
  }

  const activeOrganizations = organizations.filter(
    (organization) => organization.isActive,
  );
  const activeContactTypes = contactTypes.filter(
    (contactType) => contactType.isActive,
  );

  return (
    <>
    <AppShell
      onSectionChange={(section) => {
        if (section === "contacts") refreshContactOptions();
      }}
    >
      {(activeSection: Section) =>
        activeSection === "contacts" ? (
        <main className="main-content">
          <div className="page-heading">
            <div>
              <p className="eyebrow">Relacionamento</p>
              <h1>Contatos</h1>
              <p className="page-subtitle">
                Organize e acompanhe os contatos da sua operação.
              </p>
            </div>
            <button className="primary-button" onClick={openCreateForm} type="button">
              <Icon name="plus" size={16} />
              Novo contato
            </button>
          </div>

          {optionsError && (
            <div className="inline-error" role="alert">
              Não foi possível carregar as opções de organização e tipo de contato.{" "}
              {optionsError}
            </div>
          )}
          {settingsError && (
            <div className="inline-error" role="alert">
              Não foi possível carregar a configuração da identificação dos contatos.{" "}
              {settingsError}
            </div>
          )}
          {contactsError && (
            <div className="inline-error" role="alert">
              {contactsError}
            </div>
          )}

          <div className="toolbar" aria-label="Filtros de contatos">
            <label className="search-field">
              <Icon name="search" size={17} />
              <span className="sr-only">Pesquisar contatos</span>
              <input
                onChange={(event) =>
                  updateFilters((current) => ({
                    ...current,
                    search: event.target.value,
                  }))
                }
                placeholder="Buscar por nome, telefone, e-mail..."
                type="search"
                value={filters.search}
              />
            </label>

            <select
              aria-label="Filtrar por organização"
              className="filter-select"
              onChange={(event) =>
                updateFilters((current) => ({
                  ...current,
                  organizationId: event.target.value,
                }))
              }
              value={filters.organizationId}
            >
              <option value="">Todas as organizações</option>
              {organizations.map((organization) => (
                <option key={organization.id} value={organization.id}>
                  {organization.name}
                  {!organization.isActive ? " (inativa)" : ""}
                </option>
              ))}
            </select>

            <select
              aria-label="Filtrar por tipo de contato"
              className="filter-select"
              onChange={(event) =>
                updateFilters((current) => ({
                  ...current,
                  contactTypeId: event.target.value,
                }))
              }
              value={filters.contactTypeId}
            >
              <option value="">Todos os tipos</option>
              {contactTypes.map((contactType) => (
                <option key={contactType.id} value={contactType.id}>
                  {contactType.name}
                  {!contactType.isActive ? " (inativo)" : ""}
                </option>
              ))}
            </select>

            <select
              aria-label="Filtrar por situação"
              className="filter-select"
              onChange={(event) =>
                updateFilters((current) => ({
                  ...current,
                  isActive: event.target.value,
                }))
              }
              value={filters.isActive}
            >
              <option value="">Todas as situações</option>
              <option value="true">Ativos</option>
              <option value="false">Inativos</option>
            </select>
          </div>

          <div className="results-summary">
            <span>
              {isLoading
                ? "Carregando contatos..."
                : `${contacts.length} ${contacts.length === 1 ? "contato encontrado" : "contatos encontrados"}`}
            </span>
            <button
              aria-label="Atualizar lista de contatos"
              className="icon-button"
              disabled={isLoading}
              onClick={refreshContacts}
              title="Atualizar"
              type="button"
            >
              <Icon name="refresh" size={15} />
            </button>
          </div>

          {isLoading ? (
            <div className="table-panel loading-state" role="status">
              Carregando contatos da API...
            </div>
          ) : contactsError ? null : (
            <ContactList
              busyContactId={busyContactId}
              contacts={contacts}
              onEdit={openEditForm}
              onToggleActive={handleToggleActive}
              settings={displaySettings}
            />
          )}

          {isLoadingOptions && (
            <span className="sr-only">Carregando opções do formulário.</span>
          )}
          {isLoadingSettings && (
            <span className="sr-only">Carregando configuração de exibição.</span>
          )}
        </main>
      ) : activeSection === "settings" ? (
        <SettingsContent />
      ) : activeSection === "whatsapp-connections" ? (
        <WhatsappConnectionsScreen isVisible={activeSection === "whatsapp-connections"} />
      ) : (
        <WhatsappConversationsScreen isVisible={activeSection === "conversations"} />
      )}
    </AppShell>
    {isFormOpen && (
      <ContactFormModal
        contact={editingContact}
        contactTypes={activeContactTypes}
        isLoadingOptions={isLoadingOptions}
        onRetryOptions={refreshContactOptions}
        onClose={closeForm}
        onSaved={handleSaved}
        optionsError={optionsError}
        organizations={activeOrganizations}
      />
    )}
    {toastMessage && (
      <div className="toast" role="status">
        <Icon name="check" size={16} />
        {toastMessage}
      </div>
    )}
    </>
  );
}
