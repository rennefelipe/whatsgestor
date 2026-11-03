"use client";

import { FullTextSelect } from "../full-text-select";

import { useCallback, useEffect, useState } from "react";
import {
  getContactDisplaySettings,
  getContactTypes,
  getContactsPage,
  getContactOptions,
  getOrganizations,
  updateContactActive,
} from "@/services/api/contacts";
import type {
  Contact,
  ContactDisplaySetting,
  ContactType,
  Organization,
  ContactOptions,
} from "@/types/api";
import { AppShell } from "../app-shell";
import type { Section } from "../app-shell";
import { Icon } from "../icons";
import { UsersManagement } from "../settings/users-management";
import { SettingsHome } from "../settings/settings-home";
import { AppearanceSettings } from "../appearance/appearance-settings";
import { AutomaticMessagesScreen } from "../settings/automatic-messages-screen";
import { SettingsContent } from "../settings/settings-screen";
import { WhatsappConnectionsScreen } from "../whatsapp/whatsapp-connections-screen";
import { WhatsappMonitorScreen } from "../whatsapp/whatsapp-monitor-screen";
import { WhatsappConversationsScreen } from "../whatsapp/whatsapp-conversations-screen";
import { ContactFormModal } from "./contact-form-modal";
import { ContactList } from "./contact-list";
import { RecipientSelectionScreen } from "../bulk-send/recipient-selection-screen";
import { CampaignPreferencesModal } from "./campaign-preferences-modal";
import { useAuth } from "../auth/auth-provider";
import { DataExchangeScreen } from "../settings/data-exchange-screen";

const emptyFilters = {
  organizationId: "",
  contactTypeId: "",
  isActive: "",
  search: "",
  groupId: "",
  shoppingId: "",
  storeName: "",
  withoutStore: "",
  contactName: "",
  phone: "",
};

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Não foi possível carregar as informações.";
}

export function ContactsScreen() {
  const { user } = useAuth();
  const readOnly = user?.role === "tester";
  const [preferencesRegistry, setPreferencesRegistry] = useState(false);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [contactTypes, setContactTypes] = useState<ContactType[]>([]);
  const [displaySettings, setDisplaySettings] = useState<
    ContactDisplaySetting[]
  >([]);
  const [filters, setFilters] = useState(emptyFilters);
  const [additionalOpen, setAdditionalOpen] = useState(false);
  const [debouncedFilters, setDebouncedFilters] = useState(emptyFilters);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [contactOptions, setContactOptions] = useState<ContactOptions>({
    organizationContexts: [],
    storeNames: [],
  });
  const [contactsError, setContactsError] = useState("");
  const [optionsError, setOptionsError] = useState("");
  const [settingsError, setSettingsError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingOptions, setIsLoadingOptions] = useState(true);
  const [optionsReloadKey, setOptionsReloadKey] = useState(0);
  const [isLoadingSettings, setIsLoadingSettings] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [preferencesContact, setPreferencesContact] = useState<Contact | null>(
    null,
  );
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [busyContactId, setBusyContactId] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedFilters(filters), 300);
    return () => window.clearTimeout(timer);
  }, [filters]);

  useEffect(() => {
    if (filters !== debouncedFilters) return;
    const controller = new AbortController();

    getContactsPage(debouncedFilters, page, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setContacts(result.items);
        setTotal(result.total);
        if (page > Math.max(1, Math.ceil(result.total / result.pageSize)))
          setPage(Math.max(1, Math.ceil(result.total / result.pageSize)));
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
  }, [debouncedFilters, filters, page, reloadKey]);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      getOrganizations(controller.signal),
      getContactTypes(controller.signal),
      getContactOptions(controller.signal),
    ])
      .then(([organizationOptions, contactTypeOptions, contextOptions]) => {
        if (controller.signal.aborted) return;
        setOrganizations(organizationOptions);
        setContactTypes(contactTypeOptions);
        setContactOptions(contextOptions);
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

  function updateFilters(update: (current: typeof filters) => typeof filters) {
    setIsLoading(true);
    setContactsError("");
    setFilters(update);
    setPage(1);
  }

  async function handleToggleActive(contact: Contact) {
    if (contact.isActive && !window.confirm(`Inativar ${contact.contactName}? O histórico será preservado.`)) return;
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
    (organization) =>
      organization.isActive ||
      organization.id === editingContact?.organizationId,
  );
  const activeContactTypes = contactTypes.filter(
    (contactType) =>
      contactType.isActive || contactType.id === editingContact?.contactTypeId,
  );
  const groups = Array.from(
    new Map(
      contactOptions.organizationContexts.flatMap((context) =>
        context.group ? [[context.group.id, context.group] as const] : [],
      ),
    ).values(),
  ).sort((a, b) => a.name.localeCompare(b.name));
  const shoppings = Array.from(
    new Map(
      contactOptions.organizationContexts
        .filter(
          (context) =>
            !filters.groupId || context.group?.id === filters.groupId,
        )
        .flatMap((context) =>
          context.shopping
            ? [[context.shopping.id, context.shopping] as const]
            : [],
        ),
    ).values(),
  ).sort((a, b) => a.name.localeCompare(b.name));

  const filterLabels: Record<keyof typeof filters, string> = {
    search: "Busca",
    groupId: "Grupo",
    shoppingId: "Shopping",
    storeName: "Loja",
    withoutStore: "Loja",
    contactTypeId: "Função",
    organizationId: "Organização",
    isActive: "Situação",
    contactName: "Responsável",
    phone: "WhatsApp",
  };
  const activeFilters = (Object.keys(filters) as (keyof typeof filters)[])
    .filter((key) => filters[key] !== "")
    .map((key) => {
      const value = filters[key];
      const display =
        key === "groupId"
          ? groups.find((group) => group.id === value)?.name
          : key === "shoppingId"
            ? shoppings.find((shopping) => shopping.id === value)?.name
            : key === "organizationId"
              ? organizations.find((organization) => organization.id === value)
                  ?.name
              : key === "contactTypeId"
                ? contactTypes.find((type) => type.id === value)?.name
                : key === "withoutStore"
                  ? "Sem loja"
                  : key === "isActive"
                    ? value === "true"
                      ? "Ativos"
                      : "Inativos"
                    : value;
      return { key, label: filterLabels[key], display: display ?? value };
    });
  const additionalCount = activeFilters.filter(
    (filter) => !["search", "groupId", "shoppingId"].includes(filter.key),
  ).length;

  return (
    <>
      <AppShell
        onSectionChange={(section) => {
          if (section === "contacts") {
            refreshContacts();
            refreshContactOptions();
          }
        }}
      >
        {(activeSection: Section, navigate) =>
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
                <div className="campaign-heading-actions">
                  {user?.isAdmin && (
                    <button
                      className="secondary-button"
                      onClick={() => {
                        refreshContactOptions();
                        setPreferencesRegistry(true);
                      }}
                      type="button"
                    >
                      Restrições de envio
                    </button>
                  )}
                  {!readOnly && <button
                    className="primary-button"
                    onClick={openCreateForm}
                    type="button"
                  >
                    <Icon name="plus" size={16} />
                    Novo contato
                  </button>}
                </div>
              </div>

              {optionsError && (
                <div className="inline-error" role="alert">
                  Não foi possível carregar as opções de organização e tipo de
                  contato. {optionsError}
                </div>
              )}
              {settingsError && (
                <div className="inline-error" role="alert">
                  Não foi possível carregar a configuração da identificação dos
                  contatos. {settingsError}
                </div>
              )}
              {contactsError && (
                <div className="inline-error" role="alert">
                  {contactsError}
                </div>
              )}

              <div
                className="contacts-primary-filters"
                aria-label="Filtros principais de contatos"
              >
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
                    placeholder="Buscar por nome, telefone, loja ou organização..."
                    type="search"
                    value={filters.search}
                  />
                </label>
                <label className="contact-filter-field">
                  <span>Grupo</span>
                  <FullTextSelect
                    aria-label="Filtrar por grupo"
                    className="filter-select"
                    value={filters.groupId}
                    onChange={(event) =>
                      updateFilters((current) => ({
                        ...current,
                        groupId: event.target.value,
                        shoppingId: "",
                      }))
                    }
                  >
                    <option value="">Todos os grupos</option>
                    {groups.map((group) => (
                      <option key={group.id} value={group.id}>
                        {group.name}
                      </option>
                    ))}
                  </FullTextSelect>
                </label>
                <label className="contact-filter-field">
                  <span>Shopping</span>
                  <FullTextSelect
                    aria-label="Filtrar por shopping"
                    className="filter-select"
                    value={filters.shoppingId}
                    onChange={(event) =>
                      updateFilters((current) => ({
                        ...current,
                        shoppingId: event.target.value,
                      }))
                    }
                  >
                    <option value="">Todos os shoppings</option>
                    {shoppings.map((shopping) => (
                      <option key={shopping.id} value={shopping.id}>
                        {shopping.name}
                      </option>
                    ))}
                  </FullTextSelect>
                </label>
                <button
                  type="button"
                  className="secondary-button"
                  aria-expanded={additionalOpen}
                  aria-controls="contacts-additional-filters"
                  onClick={() => setAdditionalOpen((open) => !open)}
                >
                  Filtros adicionais
                  {additionalCount > 0 ? ` (${additionalCount})` : ""}
                </button>
              </div>
              <div
                className="contacts-additional-filters"
                id="contacts-additional-filters"
                hidden={!additionalOpen}
                aria-label="Filtros adicionais de contatos"
              >
                <label className="contact-filter-field">
                  <span>Loja</span>
                  <FullTextSelect
                    aria-label="Filtrar por loja"
                    className="filter-select"
                    value={
                      filters.withoutStore === "true"
                        ? "none"
                        : filters.storeName
                          ? `store:${filters.storeName}`
                          : ""
                    }
                    onChange={(event) =>
                      updateFilters((current) => ({
                        ...current,
                        storeName: event.target.value.startsWith("store:")
                          ? event.target.value.slice(6)
                          : "",
                        withoutStore:
                          event.target.value === "none" ? "true" : "",
                      }))
                    }
                  >
                    <option value="">Todas as lojas</option>
                    <option value="none">Sem loja</option>
                    {contactOptions.storeNames.map((name) => (
                      <option key={name} value={`store:${name}`}>
                        {name}
                      </option>
                    ))}
                  </FullTextSelect>
                </label>
                <label className="contact-filter-field">
                  <span>Função / Cargo</span>
                  <FullTextSelect
                    aria-label="Filtrar por função ou cargo"
                    className="filter-select"
                    onChange={(event) =>
                      updateFilters((current) => ({
                        ...current,
                        contactTypeId: event.target.value,
                      }))
                    }
                    value={filters.contactTypeId}
                  >
                    <option value="">Todas as funções / cargos</option>
                    {contactTypes.map((contactType) => (
                      <option key={contactType.id} value={contactType.id}>
                        {contactType.name}
                        {!contactType.isActive ? " (inativo)" : ""}
                      </option>
                    ))}
                  </FullTextSelect>
                </label>
                <label className="contact-filter-field">
                  <span>Organização</span>
                  <FullTextSelect
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
                  </FullTextSelect>
                </label>
                <label className="contact-filter-field">
                  <span>Situação</span>
                  <FullTextSelect
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
                  </FullTextSelect>
                </label>
                <label className="search-field">
                  <span className="sr-only">
                    Filtrar por nome do responsável
                  </span>
                  <input
                    type="search"
                    placeholder="Nome do responsável"
                    value={filters.contactName}
                    onChange={(event) =>
                      updateFilters((current) => ({
                        ...current,
                        contactName: event.target.value,
                      }))
                    }
                  />
                </label>
                <label className="search-field">
                  <span className="sr-only">
                    Filtrar por número de WhatsApp
                  </span>
                  <input
                    type="search"
                    placeholder="Número de WhatsApp"
                    value={filters.phone}
                    onChange={(event) =>
                      updateFilters((current) => ({
                        ...current,
                        phone: event.target.value,
                      }))
                    }
                  />
                </label>
              </div>
              {activeFilters.length > 0 && (
                <div
                  className="contact-filter-chips"
                  aria-label="Filtros ativos"
                >
                  {activeFilters.map((filter) => (
                    <button
                      type="button"
                      className="contact-filter-chip"
                      key={filter.key}
                      aria-label={`Remover filtro ${filter.label}`}
                      onClick={() =>
                        updateFilters((current) => ({
                          ...current,
                          [filter.key]: "",
                        }))
                      }
                    >
                      <span>
                        {filter.label}: {filter.display}
                      </span>
                      <span aria-hidden="true">×</span>
                    </button>
                  ))}
                  <button
                    type="button"
                    className="contact-clear-filters"
                    onClick={() => updateFilters(() => ({ ...emptyFilters }))}
                  >
                    Limpar filtros
                  </button>
                </div>
              )}

              <div className="results-summary">
                <span>
                  {isLoading
                    ? "Carregando contatos..."
                    : `${total} ${total === 1 ? "contato encontrado" : "contatos encontrados"}`}
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
                  readOnly={readOnly}
                  onPreferences={(contact) => {
                    refreshContactOptions();
                    setPreferencesContact(contact);
                  }}
                  busyContactId={busyContactId}
                  contacts={contacts}
                  onEdit={openEditForm}
                  onToggleActive={handleToggleActive}
                  settings={displaySettings}
                />
              )}

              <div
                className="results-summary"
                aria-label="Paginação de contatos"
              >
                <button
                  type="button"
                  className="secondary-button"
                  disabled={isLoading || page <= 1}
                  onClick={() => {
                    setIsLoading(true);
                    setPage((current) => current - 1);
                  }}
                >
                  Anterior
                </button>
                <span>
                  Página {page} de {Math.max(1, Math.ceil(total / 25))}
                </span>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={isLoading || page * 25 >= total}
                  onClick={() => {
                    setIsLoading(true);
                    setPage((current) => current + 1);
                  }}
                >
                  Próxima
                </button>
              </div>

              {isLoadingOptions && (
                <span className="sr-only">
                  Carregando opções do formulário.
                </span>
              )}
              {isLoadingSettings && (
                <span className="sr-only">
                  Carregando configuração de exibição.
                </span>
              )}
            </main>
          ) : activeSection === "bulk-send" ? (
            <RecipientSelectionScreen
              onOpenContacts={(phone) => {
                if (phone)
                  updateFilters(() => ({ ...emptyFilters, search: phone }));
                navigate("contacts");
              }}
            />
          ) : activeSection === "users" ? (
            <main className="main-content"><UsersManagement /></main>
          ) : activeSection === "settings" ? (
            <SettingsHome navigate={navigate} />
          ) : activeSection === "data-exchange" ? (
            <DataExchangeScreen />
          ) : activeSection === "appearance" ? (
            <main className="main-content"><div className="page-heading"><h1>Aparência</h1></div><AppearanceSettings /></main>
          ) : activeSection === "automatic-messages" ? (
            user?.isAdmin ? <AutomaticMessagesScreen /> : <SettingsHome navigate={navigate} />
          ) : activeSection === "organizations" || activeSection === "organization-types" || activeSection === "contact-types" || activeSection === "contact-identification" ? (
            <SettingsContent key={activeSection} initialSection={activeSection} />
          ) : activeSection === "whatsapp-monitor" ? (
            <WhatsappMonitorScreen />
          ) : activeSection === "whatsapp-connections" ? (
            <WhatsappConnectionsScreen
              isVisible={activeSection === "whatsapp-connections"}
            />
          ) : (
            <WhatsappConversationsScreen
              isVisible={activeSection === "conversations"}
            />
          )
        }
      </AppShell>
      {isFormOpen && !readOnly && (
        <ContactFormModal
          contact={editingContact}
          contactTypes={activeContactTypes}
          isLoadingOptions={isLoadingOptions}
          onRetryOptions={refreshContactOptions}
          onClose={closeForm}
          onSaved={handleSaved}
          optionsError={optionsError}
          organizations={activeOrganizations}
          organizationContexts={contactOptions.organizationContexts}
        />
      )}
      {preferencesContact && !readOnly && (
        <CampaignPreferencesModal
          key={preferencesContact.id}
          contact={preferencesContact}
          options={contactOptions}
          onClose={() => setPreferencesContact(null)}
        />
      )}
      {preferencesRegistry && !readOnly && (
        <CampaignPreferencesModal
          contact={null}
          options={contactOptions}
          onClose={() => setPreferencesRegistry(false)}
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
