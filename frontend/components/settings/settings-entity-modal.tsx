"use client";

import { FullTextInput } from "../full-text-input";

import { FullTextSelect } from "../full-text-select";
import { organizationRole } from "../organization-role";

import { useEffect, useState, type FormEvent } from "react";
import type { ContactType, Organization, OrganizationType } from "@/types/api";
import {
  createContactType,
  createOrganization,
  createOrganizationType,
  updateContactType,
  updateOrganization,
  updateOrganizationType,
} from "@/services/api/settings";
import type { OrganizationPayload } from "@/services/api/settings";
import { Icon } from "../icons";

export type SettingsEntityKind =
  "organization-types" | "organizations" | "contact-types";
export type SettingsEntity =
  OrganizationType | Organization | ContactType | null;

interface SettingsEntityModalProps {
  kind: SettingsEntityKind;
  entity: SettingsEntity;
  organizationTypes: OrganizationType[];
  organizations: Organization[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Não foi possível salvar as alterações.";
}

function isOrganization(
  kind: SettingsEntityKind,
  entity: SettingsEntity,
): entity is Organization {
  return kind === "organizations" && entity !== null;
}

export function SettingsEntityModal({
  kind,
  entity,
  organizationTypes,
  organizations,
  onClose,
  onSaved,
}: SettingsEntityModalProps) {
  const [name, setName] = useState(entity?.name ?? "");
  const [isActive, setIsActive] = useState(entity?.isActive ?? true);
  const [organizationTypeId, setOrganizationTypeId] = useState(
    isOrganization(kind, entity) ? entity.organizationTypeId : "",
  );
  const [parentOrganizationId, setParentOrganizationId] = useState(
    isOrganization(kind, entity) ? (entity.parentOrganizationId ?? "") : "",
  );
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const isEditing = entity !== null;
  const isOrganizationForm = kind === "organizations";
  const selectedRole = organizationRole(
    organizationTypes.find((type) => type.id === organizationTypeId)?.name,
  );
  const parentChoices = organizations.filter((organization) => {
    if (organization.id === entity?.id || !organization.isActive) return false;
    const type =
      organizationTypes.find(
        (item) => item.id === organization.organizationTypeId,
      ) ?? organization.organizationType;
    if (selectedRole === "shopping")
      return (
        organizationRole(type?.name) === "group" &&
        !!type?.isActive &&
        !organization.parentOrganizationId
      );
    const visited = new Set<string>();
    let current: Organization | undefined = organization;
    while (current) {
      if (current.id === entity?.id || visited.has(current.id)) return false;
      visited.add(current.id);
      current = organizations.find(
        (item) => item.id === current?.parentOrganizationId,
      );
    }
    return true;
  });

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
    try {
      if (kind === "organizations") {
        const payload: OrganizationPayload = {
          name: name.trim(),
          organizationTypeId,
          parentOrganizationId: parentOrganizationId || null,
          isActive,
        };
        if (entity) {
          await updateOrganization(entity.id, payload);
        } else {
          await createOrganization(payload);
        }
      } else {
        const payload = { name: name.trim(), isActive };
        if (kind === "organization-types") {
          if (entity) {
            await updateOrganizationType(entity.id, payload);
          } else {
            await createOrganizationType(payload);
          }
        } else if (entity) {
          await updateContactType(entity.id, payload);
        } else {
          await createContactType(payload);
        }
      }
      await onSaved();
    } catch (saveError) {
      setError(errorMessage(saveError));
    } finally {
      setIsSaving(false);
    }
  }

  const title = isEditing ? "Editar" : "Novo";
  const entityTitle =
    kind === "organization-types"
      ? "tipo de organização"
      : kind === "organizations"
        ? "organização"
        : "tipo de contato";

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isSaving) onClose();
      }}
    >
      <section
        aria-labelledby="settings-entity-title"
        aria-modal="true"
        className="modal"
        role="dialog"
      >
        <header className="modal-header">
          <div>
            <h2 id="settings-entity-title">
              {title} {entityTitle}
            </h2>
            <p>Informe os dados e a situação do cadastro.</p>
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
            {isOrganizationForm && (
              <>
                <div className="form-field">
                  <label htmlFor="settings-organization-type">
                    O que deseja cadastrar? *
                  </label>
                  <FullTextSelect
                    id="settings-organization-type"
                    onChange={(event) => {
                      setOrganizationTypeId(event.target.value);
                      setParentOrganizationId("");
                      if (
                        organizationRole(
                          organizationTypes.find(
                            (type) => type.id === event.target.value,
                          )?.name,
                        ) === "group"
                      )
                        setParentOrganizationId("");
                    }}
                    required
                    value={organizationTypeId}
                  >
                    <option value="">Selecione um tipo</option>
                    {organizationTypes
                      .filter((type) => type.isActive)
                      .map((type) => (
                        <option key={type.id} value={type.id}>
                          {type.name}
                        </option>
                      ))}
                    {entity &&
                      organizationTypes.some(
                        (type) =>
                          type.id === organizationTypeId && !type.isActive,
                      ) && (
                        <option value={organizationTypeId}>
                          {organizationTypes.find(
                            (type) => type.id === organizationTypeId,
                          )?.name ?? "Tipo atual"}{" "}
                          (inativo)
                        </option>
                      )}
                  </FullTextSelect>
                </div>
                <div className="form-field">
              <label htmlFor="settings-entity-name">
                {isOrganizationForm && selectedRole === "group"
                  ? "Nome do grupo"
                  : isOrganizationForm && selectedRole === "shopping"
                    ? "Nome do shopping"
                    : "Nome"}{" "}
                *
              </label>
              <FullTextInput
                autoFocus
                id="settings-entity-name"
                maxLength={isOrganizationForm ? 150 : 100}
                onChange={(event) => setName(event.target.value)}
                required
                value={name}
              />
            </div>
                {organizationTypeId && selectedRole !== "group" && (
                  <div className="form-field">
                    <label htmlFor="settings-parent-organization">
                      {selectedRole === "shopping"
                        ? "Grupo responsável"
                        : "Organização pai"}
                      {selectedRole !== "shopping" && <span>· opcional</span>}
                    </label>
                    <FullTextSelect
                      id="settings-parent-organization"
                      value={parentOrganizationId}
                      required={selectedRole === "shopping"}
                      onChange={(event) =>
                        setParentOrganizationId(event.target.value)
                      }
                    >
                      <option value="">
                        {selectedRole === "shopping"
                          ? "Selecione um grupo"
                          : "Sem organização pai"}
                      </option>
                      {parentChoices.map((organization) => (
                        <option key={organization.id} value={organization.id}>
                          {organization.name}
                        </option>
                      ))}
                      {parentOrganizationId &&
                        !parentChoices.some(
                          (organization) =>
                            organization.id === parentOrganizationId,
                        ) && (
                          <option value={parentOrganizationId} disabled>
                            Vínculo atual incompatível:{" "}
                            {organizations.find(
                              (organization) =>
                                organization.id === parentOrganizationId,
                            )?.name ?? "não encontrado"}
                          </option>
                        )}
                    </FullTextSelect>
                    {selectedRole === "shopping" && (
                      <p className="form-help">
                        Somente grupos ativos e com hierarquia válida.
                      </p>
                    )}
                  </div>
                )}
                {selectedRole === "group" && parentOrganizationId && (
                  <div className="form-error">
                    Este registro possui um vínculo legado. Ele será preservado
                    até uma correção explícita.
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => setParentOrganizationId("")}
                    >
                      Remover organização pai deste grupo
                    </button>
                  </div>
                )}
              </>
            )}

            {!isOrganizationForm && (<div className="form-field">
              <label htmlFor="settings-entity-name">
                {isOrganizationForm && selectedRole === "group"
                  ? "Nome do grupo"
                  : isOrganizationForm && selectedRole === "shopping"
                    ? "Nome do shopping"
                    : "Nome"}{" "}
                *
              </label>
              <FullTextInput
                autoFocus
                id="settings-entity-name"
                maxLength={isOrganizationForm ? 150 : 100}
                onChange={(event) => setName(event.target.value)}
                required
                value={name}
              />
            </div>)}
            <div className="form-field">
              <label htmlFor="settings-entity-active">Situação</label>
              <FullTextSelect
                id="settings-entity-active"
                onChange={(event) => setIsActive(event.target.value === "true")}
                value={String(isActive)}
              >
                <option value="true">Ativo</option>
                <option value="false">Inativo</option>
              </FullTextSelect>
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
              disabled={isSaving}
              type="submit"
            >
              {isSaving ? "Salvando..." : "Salvar"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
