"use client";

import { useEffect, useState, type FormEvent } from "react";
import type {
  ContactType,
  Organization,
  OrganizationType,
} from "@/types/api";
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
  | "organization-types"
  | "organizations"
  | "contact-types";
export type SettingsEntity =
  | OrganizationType
  | Organization
  | ContactType
  | null;

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
    isOrganization(kind, entity) ? entity.parentOrganizationId ?? "" : "",
  );
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const isEditing = entity !== null;
  const isOrganizationForm = kind === "organizations";

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

  const title = isEditing
    ? "Editar"
    : "Novo";
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
            <div className="form-field">
              <label htmlFor="settings-entity-name">Nome *</label>
              <input
                autoFocus
                id="settings-entity-name"
                maxLength={isOrganizationForm ? 150 : 100}
                onChange={(event) => setName(event.target.value)}
                required
                value={name}
              />
            </div>

            {isOrganizationForm && (
              <>
                <div className="form-field">
                  <label htmlFor="settings-organization-type">
                    Tipo de organização *
                  </label>
                  <select
                    id="settings-organization-type"
                    onChange={(event) =>
                      setOrganizationTypeId(event.target.value)
                    }
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
                          )?.name ?? "Tipo atual"} (inativo)
                        </option>
                      )}
                  </select>
                </div>
                <div className="form-field">
                  <label htmlFor="settings-parent-organization">
                    Organização pai <span>· opcional</span>
                  </label>
                  <select
                    id="settings-parent-organization"
                    onChange={(event) =>
                      setParentOrganizationId(event.target.value)
                    }
                    value={parentOrganizationId}
                  >
                    <option value="">Sem organização pai</option>
                    {organizations
                      .filter(
                        (organization) =>
                          organization.id !== entity?.id &&
                          organization.isActive,
                      )
                      .map((organization) => (
                        <option key={organization.id} value={organization.id}>
                          {organization.name}
                        </option>
                      ))}
                    {parentOrganizationId &&
                      organizations.some(
                        (organization) =>
                          organization.id === parentOrganizationId &&
                          !organization.isActive,
                      ) && (
                        <option value={parentOrganizationId}>
                          {organizations.find(
                            (organization) =>
                              organization.id === parentOrganizationId,
                          )?.name ?? "Organização atual"} (inativa)
                        </option>
                      )}
                  </select>
                </div>
              </>
            )}

            <div className="form-field">
              <label htmlFor="settings-entity-active">Situação</label>
              <select
                id="settings-entity-active"
                onChange={(event) =>
                  setIsActive(event.target.value === "true")
                }
                value={String(isActive)}
              >
                <option value="true">Ativo</option>
                <option value="false">Inativo</option>
              </select>
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
            <button className="primary-button" disabled={isSaving} type="submit">
              {isSaving ? "Salvando..." : "Salvar"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
