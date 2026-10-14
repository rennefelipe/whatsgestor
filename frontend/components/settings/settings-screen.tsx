"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getContactDisplaySettings } from "@/services/api/contacts";
import {
  getOrganizationTypes,
  getSettingsContactTypes,
  getSettingsOrganizations,
  updateContactDisplaySetting,
  updateContactTypeActive,
  updateOrganizationActive,
  updateOrganizationTypeActive,
} from "@/services/api/settings";
import type {
  ContactDisplayField,
  ContactDisplaySetting,
  ContactType,
  Organization,
  OrganizationType,
} from "@/types/api";
import { useAuth } from "../auth/auth-provider";
import { Icon } from "../icons";
import {
  SettingsEntityModal,
  type SettingsEntity,
  type SettingsEntityKind,
} from "./settings-entity-modal";
import { AppearanceSettings } from "../appearance/appearance-settings";
import { UsersManagement } from "./users-management";

type SettingsSection =
  | "organization-types"
  | "organizations"
  | "contact-types"
  | "contact-identification"
  | "users";
type DisplayFieldKey =
  "group" | "shopping" | "store" | "contactType" | "contactName";
type SupportedDisplaySetting = ContactDisplaySetting & {
  fieldKey: DisplayFieldKey;
};

const sections: { id: SettingsSection; label: string }[] = [
  { id: "organization-types", label: "Tipos de organização" },
  { id: "organizations", label: "Organizações" },
  { id: "contact-types", label: "Tipos de contato" },
  { id: "contact-identification", label: "Identificação dos contatos" },
  { id: "users", label: "Usuários" },
];

const displayFieldLabels: Record<DisplayFieldKey, string> = {
  group: "Grupo",
  shopping: "Shopping",
  store: "Loja",
  contactType: "Tipo de contato",
  contactName: "Responsável",
};

const displayFieldOrder: DisplayFieldKey[] = [
  "group",
  "shopping",
  "store",
  "contactType",
  "contactName",
];

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Não foi possível carregar as configurações.";
}

function isDisplayFieldKey(key: ContactDisplayField): key is DisplayFieldKey {
  return displayFieldOrder.some((field) => field === key);
}

function getHierarchy(organizations: Organization[]): {
  organization: Organization;
  depth: number;
}[] {
  const byId = new Map(
    organizations.map((organization) => [organization.id, organization]),
  );
  const children = new Map<string | null, Organization[]>();
  for (const organization of organizations) {
    const parentId =
      organization.parentOrganizationId &&
      byId.has(organization.parentOrganizationId)
        ? organization.parentOrganizationId
        : null;
    const siblings = children.get(parentId) ?? [];
    siblings.push(organization);
    children.set(parentId, siblings);
  }
  for (const siblings of children.values()) {
    siblings.sort((left, right) =>
      left.name.localeCompare(right.name, "pt-BR"),
    );
  }

  const result: { organization: Organization; depth: number }[] = [];
  const visited = new Set<string>();
  function append(parentId: string | null, depth: number) {
    for (const organization of children.get(parentId) ?? []) {
      if (visited.has(organization.id)) continue;
      visited.add(organization.id);
      result.push({ organization, depth });
      append(organization.id, depth + 1);
    }
  }
  append(null, 0);
  for (const organization of organizations) {
    if (!visited.has(organization.id)) {
      visited.add(organization.id);
      result.push({ organization, depth: 0 });
      append(organization.id, 1);
    }
  }
  return result;
}

export function SettingsContent() {
  const { user } = useAuth();
  const [section, setSection] = useState<SettingsSection>("organization-types");
  const [organizationTypes, setOrganizationTypes] = useState<
    OrganizationType[]
  >([]);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [contactTypes, setContactTypes] = useState<ContactType[]>([]);
  const [displaySettings, setDisplaySettings] = useState<
    SupportedDisplaySetting[]
  >([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [toastMessage, setToastMessage] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [isSavingDisplay, setIsSavingDisplay] = useState(false);
  const [editingEntity, setEditingEntity] = useState<SettingsEntity>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [displayDraft, setDisplayDraft] = useState<SupportedDisplaySetting[]>(
    [],
  );

  const loadSettings = useCallback(async (signal?: AbortSignal) => {
    setIsLoading(true);
    setLoadError("");
    try {
      const [
        organizationTypeList,
        organizationList,
        contactTypeList,
        displaySettingList,
      ] = await Promise.all([
        getOrganizationTypes(signal),
        getSettingsOrganizations(signal),
        getSettingsContactTypes(signal),
        getContactDisplaySettings(signal),
      ]);
      setOrganizationTypes(organizationTypeList);
      setOrganizations(organizationList);
      setContactTypes(contactTypeList);
      const supportedSettings = displaySettingList.filter(
        (setting): setting is SupportedDisplaySetting =>
          isDisplayFieldKey(setting.fieldKey),
      );
      const missingFields = displayFieldOrder.filter(
        (field) =>
          !supportedSettings.some((setting) => setting.fieldKey === field),
      );
      if (missingFields.length > 0) {
        throw new Error(
          `A API não retornou todos os campos de identificação esperados: ${missingFields
            .map((field) => displayFieldLabels[field])
            .join(", ")}.`,
        );
      }
      setDisplaySettings(supportedSettings);
      setDisplayDraft(supportedSettings);
    } catch (error) {
      if (!signal?.aborted) setLoadError(errorMessage(error));
    } finally {
      if (!signal?.aborted) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(() => {
      if (!controller.signal.aborted) {
        void loadSettings(controller.signal);
      }
    });
    return () => controller.abort();
  }, [loadSettings]);

  useEffect(() => {
    if (!toastMessage) return;
    const timer = window.setTimeout(() => setToastMessage(""), 3200);
    return () => window.clearTimeout(timer);
  }, [toastMessage]);

  const hierarchy = useMemo(() => getHierarchy(organizations), [organizations]);
  const currentSection =
    section === "users" && !user?.isAdmin ? "organization-types" : section;
  const entityKind: SettingsEntityKind | null =
    currentSection === "contact-identification" || currentSection === "users"
      ? null
      : currentSection;
  const hasDisplayChanges = displayDraft.some((draft) => {
    const original = displaySettings.find((setting) => setting.id === draft.id);
    return (
      !original ||
      original.isVisible !== draft.isVisible ||
      original.displayOrder !== draft.displayOrder
    );
  });

  function openCreateForm() {
    setEditingEntity(null);
    setActionError("");
    setIsFormOpen(true);
  }

  function openEditForm(entity: SettingsEntity) {
    setEditingEntity(entity);
    setActionError("");
    setIsFormOpen(true);
  }

  function closeForm() {
    setIsFormOpen(false);
    setEditingEntity(null);
  }

  async function handleEntitySaved() {
    const wasEditing = editingEntity !== null;
    closeForm();
    await loadSettings();
    setToastMessage(
      wasEditing
        ? "Cadastro atualizado com sucesso."
        : "Cadastro realizado com sucesso.",
    );
  }

  async function toggleActive(
    kind: SettingsEntityKind,
    entity: OrganizationType | Organization | ContactType,
  ) {
    setBusyId(entity.id);
    setActionError("");
    try {
      const nextActive = !entity.isActive;
      if (kind === "organization-types") {
        await updateOrganizationTypeActive(entity.id, nextActive);
      } else if (kind === "organizations") {
        await updateOrganizationActive(entity.id, nextActive);
      } else {
        await updateContactTypeActive(entity.id, nextActive);
      }
      await loadSettings();
      setToastMessage(
        nextActive
          ? "Cadastro ativado com sucesso."
          : "Cadastro inativado com sucesso.",
      );
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setBusyId(null);
    }
  }

  function updateDisplayDraft(
    id: string,
    update: (setting: SupportedDisplaySetting) => SupportedDisplaySetting,
  ) {
    setDisplayDraft((current) =>
      current.map((setting) => (setting.id === id ? update(setting) : setting)),
    );
  }

  function moveDisplayField(id: string, offset: -1 | 1) {
    setDisplayDraft((current) => {
      const ordered = [...current].sort(
        (left, right) => left.displayOrder - right.displayOrder,
      );
      const currentIndex = ordered.findIndex((setting) => setting.id === id);
      const targetIndex = currentIndex + offset;
      if (
        currentIndex < 0 ||
        targetIndex < 0 ||
        targetIndex >= ordered.length
      ) {
        return current;
      }
      [ordered[currentIndex], ordered[targetIndex]] = [
        ordered[targetIndex],
        ordered[currentIndex],
      ];
      return ordered.map((setting, index) => ({
        ...setting,
        displayOrder: index + 1,
      }));
    });
  }

  async function saveDisplaySettings() {
    setActionError("");
    setIsSavingDisplay(true);
    try {
      const ordered = [...displayDraft].sort(
        (left, right) => left.displayOrder - right.displayOrder,
      );
      await Promise.all(
        ordered.map((setting, index) =>
          updateContactDisplaySetting(setting.id, {
            isVisible: setting.isVisible,
            displayOrder: index + 1,
          }),
        ),
      );
      await loadSettings();
      setToastMessage("Identificação dos contatos salva com sucesso.");
    } catch (error) {
      setActionError(errorMessage(error));
      await loadSettings();
    } finally {
      setIsSavingDisplay(false);
    }
  }

  const orderedDisplayDraft = [...displayDraft].sort(
    (left, right) => left.displayOrder - right.displayOrder,
  );

  return (
    <>
      <main className="main-content settings-content">
        <div className="page-heading">
          <div>
            <p className="eyebrow">Preferências do sistema</p>
            <h1>Configurações</h1>
            <p className="page-subtitle">
              Gerencie organizações, tipos e identificação dos contatos.
            </p>
          </div>
          {currentSection !== "contact-identification" &&
            currentSection !== "users" && (
              <button
                className="primary-button"
                onClick={openCreateForm}
                type="button"
              >
                <Icon name="plus" size={16} />
                Novo cadastro
              </button>
            )}
        </div>

        <AppearanceSettings />
        <div
          aria-label="Seções de configurações"
          className="settings-tabs"
          role="tablist"
        >
          {sections
            .filter((item) => item.id !== "users" || user?.isAdmin)
            .map((item) => (
              <button
                aria-selected={currentSection === item.id}
                className={`settings-tab${currentSection === item.id ? " active" : ""}`}
                id={`settings-tab-${item.id}`}
                key={item.id}
                onClick={() => {
                  setSection(item.id);
                  setActionError("");
                }}
                role="tab"
                type="button"
              >
                {item.label}
              </button>
            ))}
        </div>

        <div
          aria-labelledby={`settings-tab-${currentSection}`}
          className="settings-panel"
          role="tabpanel"
        >
          {loadError && (
            <div className="inline-error" role="alert">
              Não foi possível carregar as configurações. {loadError}
            </div>
          )}
          {actionError && (
            <div className="inline-error" role="alert">
              {actionError}
            </div>
          )}
          {isLoading ? (
            <div className="table-panel loading-state" role="status">
              Carregando configurações da API...
            </div>
          ) : loadError ? null : currentSection === "users" ? (
            user?.isAdmin ? (
              <UsersManagement />
            ) : null
          ) : currentSection === "contact-identification" ? (
            <section className="display-settings">
              <div className="display-settings-heading">
                <div>
                  <h2>Identificação dos contatos</h2>
                  <p>
                    Esta configuração é global e será aplicada a todos os
                    usuários.
                  </p>
                </div>
                <button
                  className="primary-button"
                  disabled={!hasDisplayChanges || isSavingDisplay}
                  onClick={() => void saveDisplaySettings()}
                  type="button"
                >
                  {isSavingDisplay ? "Salvando..." : "Salvar alterações"}
                </button>
              </div>

              <div className="display-settings-grid">
                <div className="table-panel settings-table-panel">
                  <div className="contact-table-scroll">
                    <table className="settings-table">
                      <thead>
                        <tr>
                          <th>Campo</th>
                          <th>Visibilidade</th>
                          <th>Ordem</th>
                        </tr>
                      </thead>
                      <tbody>
                        {orderedDisplayDraft.map((setting, index) => (
                          <tr key={setting.id}>
                            <td className="settings-name">
                              {displayFieldLabels[setting.fieldKey]}
                            </td>
                            <td>
                              <label className="visibility-toggle">
                                <input
                                  checked={setting.isVisible}
                                  onChange={(event) =>
                                    updateDisplayDraft(
                                      setting.id,
                                      (current) => ({
                                        ...current,
                                        isVisible: event.target.checked,
                                      }),
                                    )
                                  }
                                  type="checkbox"
                                />
                                <span>
                                  {setting.isVisible ? "Visível" : "Oculto"}
                                </span>
                              </label>
                            </td>
                            <td>
                              <div className="row-actions settings-order-actions">
                                <span className="order-number">
                                  {index + 1}
                                </span>
                                <button
                                  aria-label={`Subir ${displayFieldLabels[setting.fieldKey]}`}
                                  className="order-button"
                                  disabled={index === 0}
                                  onClick={() =>
                                    moveDisplayField(setting.id, -1)
                                  }
                                  type="button"
                                >
                                  ↑
                                </button>
                                <button
                                  aria-label={`Descer ${displayFieldLabels[setting.fieldKey]}`}
                                  className="order-button"
                                  disabled={
                                    index === orderedDisplayDraft.length - 1
                                  }
                                  onClick={() =>
                                    moveDisplayField(setting.id, 1)
                                  }
                                  type="button"
                                >
                                  ↓
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
                <aside className="identity-preview">
                  <h3>Prévia da identificação</h3>
                  <p>Exemplo ilustrativo</p>
                  <div className="identity-preview-content">
                    {orderedDisplayDraft
                      .filter((setting) => setting.isVisible)
                      .map((setting) => (
                        <span key={setting.id}>
                          {displayFieldLabels[setting.fieldKey]}
                        </span>
                      ))}
                    {orderedDisplayDraft.every(
                      (setting) => !setting.isVisible,
                    ) && (
                      <span className="identity-preview-empty">
                        Nenhum campo visível
                      </span>
                    )}
                  </div>
                </aside>
              </div>
            </section>
          ) : (
            <EntityList
              busyId={busyId}
              contactTypes={contactTypes}
              hierarchy={hierarchy}
              kind={currentSection}
              onEdit={openEditForm}
              onToggleActive={(entity) =>
                void toggleActive(currentSection, entity)
              }
              organizationTypes={organizationTypes}
            />
          )}
        </div>
      </main>

      {isFormOpen && entityKind && (
        <SettingsEntityModal
          entity={editingEntity}
          kind={entityKind}
          onClose={closeForm}
          onSaved={handleEntitySaved}
          organizationTypes={organizationTypes}
          organizations={organizations}
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

interface EntityListProps {
  kind: SettingsEntityKind;
  organizationTypes: OrganizationType[];
  contactTypes: ContactType[];
  hierarchy: { organization: Organization; depth: number }[];
  busyId: string | null;
  onEdit: (entity: SettingsEntity) => void;
  onToggleActive: (
    entity: OrganizationType | Organization | ContactType,
  ) => void;
}

function EntityList({
  kind,
  organizationTypes,
  contactTypes,
  hierarchy,
  busyId,
  onEdit,
  onToggleActive,
}: EntityListProps) {
  const rows: {
    entity: OrganizationType | Organization | ContactType;
    depth?: number;
  }[] =
    kind === "organization-types"
      ? organizationTypes.map((entity) => ({ entity }))
      : kind === "organizations"
        ? hierarchy.map(({ organization, depth }) => ({
            entity: organization,
            depth,
          }))
        : contactTypes.map((entity) => ({ entity }));
  const emptyLabel =
    kind === "organization-types"
      ? "Nenhum tipo de organização cadastrado"
      : kind === "organizations"
        ? "Nenhuma organização cadastrada"
        : "Nenhum tipo de contato cadastrado";
  const isOrganizationList = kind === "organizations";

  return (
    <>
      <div className="results-summary">
        <span>
          {rows.length} {rows.length === 1 ? "cadastro" : "cadastros"}
        </span>
      </div>
      <div className="table-panel settings-table-panel">
        {rows.length === 0 ? (
          <div className="empty-state">
            <strong>{emptyLabel}</strong>
            <p>Use “Novo cadastro” para adicionar o primeiro.</p>
          </div>
        ) : (
          <div className="contact-table-scroll">
            <table className="settings-table">
              <thead>
                <tr>
                  <th>Nome</th>
                  {isOrganizationList && (
                    <>
                      <th>Tipo</th>
                      <th>Organização pai</th>
                    </>
                  )}
                  <th>Situação</th>
                  <th aria-label="Ações" />
                </tr>
              </thead>
              <tbody>
                {rows.map(({ entity, depth = 0 }) => {
                  const organization =
                    isOrganizationList && "organizationTypeId" in entity
                      ? entity
                      : null;
                  const typeName = organization
                    ? (organizationTypes.find(
                        (type) => type.id === organization.organizationTypeId,
                      )?.name ??
                      organization.organizationType?.name ??
                      "—")
                    : "";
                  const parentName = organization?.parentOrganizationId
                    ? (organizationsFromHierarchy(hierarchy).get(
                        organization.parentOrganizationId,
                      )?.name ??
                      organization.parentOrganization?.name ??
                      "—")
                    : "—";
                  return (
                    <tr key={entity.id}>
                      <td>
                        <span
                          className={
                            depth > 0
                              ? "settings-name hierarchy-name"
                              : "settings-name"
                          }
                          style={
                            depth > 0
                              ? { paddingLeft: `${depth * 19}px` }
                              : undefined
                          }
                        >
                          {depth > 0 && (
                            <span
                              aria-hidden="true"
                              className="hierarchy-branch"
                            >
                              ↳
                            </span>
                          )}
                          {entity.name}
                        </span>
                      </td>
                      {isOrganizationList && (
                        <>
                          <td>{typeName}</td>
                          <td>{parentName}</td>
                        </>
                      )}
                      <td>
                        <span
                          className={`status-pill${entity.isActive ? " active" : " inactive"}`}
                        >
                          {entity.isActive ? "Ativo" : "Inativo"}
                        </span>
                      </td>
                      <td>
                        <div className="row-actions">
                          <button
                            aria-label={`Editar ${entity.name}`}
                            className="icon-button"
                            onClick={() => onEdit(entity)}
                            title="Editar"
                            type="button"
                          >
                            <Icon name="edit" size={15} />
                          </button>
                          <button
                            aria-label={`${entity.isActive ? "Inativar" : "Ativar"} ${entity.name}`}
                            className="icon-button"
                            disabled={busyId === entity.id}
                            onClick={() => onToggleActive(entity)}
                            title={entity.isActive ? "Inativar" : "Ativar"}
                            type="button"
                          >
                            <Icon
                              name={entity.isActive ? "deactivate" : "activate"}
                              size={15}
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
    </>
  );
}

function organizationsFromHierarchy(
  hierarchy: { organization: Organization; depth: number }[],
): Map<string, Organization> {
  return new Map(
    hierarchy.map(({ organization }) => [organization.id, organization]),
  );
}
