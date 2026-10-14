"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  createUser,
  getUsers,
  updateUser,
  updateUserActive,
  updateUserDeletePermission,
} from "@/services/api/users";
import type {
  AuthenticatedUser,
  CreateUserPayload,
  UpdateUserPayload,
} from "@/types/api";
import { useAuth } from "../auth/auth-provider";
import { Icon } from "../icons";

function getErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Não foi possível concluir a operação.";
}

export function UsersManagement() {
  const { user: currentUser, logout, refreshUser } = useAuth();
  const [users, setUsers] = useState<AuthenticatedUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [toastMessage, setToastMessage] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingUser, setEditingUser] = useState<AuthenticatedUser | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);

  const loadUsers = useCallback(async (signal?: AbortSignal) => {
    setIsLoading(true);
    setLoadError("");
    try {
      const result = await getUsers(signal);
      setUsers(result);
    } catch (error) {
      if (!signal?.aborted) setLoadError(getErrorMessage(error));
    } finally {
      if (!signal?.aborted) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(() => {
      if (!controller.signal.aborted) void loadUsers(controller.signal);
    });
    return () => controller.abort();
  }, [loadUsers]);

  useEffect(() => {
    if (!toastMessage) return;
    const timer = window.setTimeout(() => setToastMessage(""), 3200);
    return () => window.clearTimeout(timer);
  }, [toastMessage]);

  function openForm(user: AuthenticatedUser | null) {
    setEditingUser(user);
    setActionError("");
    setIsFormOpen(true);
  }

  async function saveUser(
    payload: CreateUserPayload | UpdateUserPayload,
  ): Promise<void> {
    const wasEditing = editingUser !== null;
    if (editingUser) {
      await updateUser(editingUser.id, payload as UpdateUserPayload);
      if (editingUser.id === currentUser?.id) {
        const updatedUser = await refreshUser();
        if (!updatedUser.isActive) logout();
      }
    } else {
      await createUser(payload as CreateUserPayload);
    }
    setIsFormOpen(false);
    setEditingUser(null);
    await loadUsers();
    setToastMessage(
      wasEditing
        ? "Usuário atualizado com sucesso."
        : "Usuário cadastrado com sucesso.",
    );
  }

  async function toggleActive(user: AuthenticatedUser) {
    setBusyId(user.id);
    setActionError("");
    try {
      await updateUserActive(user.id, !user.isActive);
      if (user.id === currentUser?.id && user.isActive) {
        logout();
        return;
      }
      await loadUsers();
      setToastMessage(
        user.isActive
          ? "Usuário desativado com sucesso."
          : "Usuário ativado com sucesso.",
      );
    } catch (error) {
      setActionError(getErrorMessage(error));
    } finally {
      setBusyId(null);
    }
  }

  async function toggleDeletePermission(user: AuthenticatedUser) {
    setBusyId(user.id);
    setActionError("");
    try {
      await updateUserDeletePermission(user.id, !user.canDelete);
      await loadUsers();
      setToastMessage(
        user.canDelete
          ? "Permissão de exclusão retirada."
          : "Permissão de exclusão concedida.",
      );
    } catch (error) {
      setActionError(getErrorMessage(error));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <div className="users-management">
        <div className="users-management-heading">
          <div>
            <h2>Usuários</h2>
            <p>Gerencie o acesso e as permissões dos usuários do sistema.</p>
          </div>
          <button
            className="primary-button"
            onClick={() => openForm(null)}
            type="button"
          >
            <Icon name="plus" size={16} />
            Novo usuário
          </button>
        </div>

        {loadError && (
          <div className="inline-error" role="alert">
            Não foi possível carregar os usuários. {loadError}
            <button
              className="secondary-button users-retry-button"
              onClick={() => void loadUsers()}
              type="button"
            >
              Tentar novamente
            </button>
          </div>
        )}
        {actionError && (
          <div className="inline-error" role="alert">
            {actionError}
          </div>
        )}

        {isLoading ? (
          <div className="table-panel loading-state" role="status">
            Carregando usuários...
          </div>
        ) : loadError ? null : (
          <div className="table-panel settings-table-panel">
            {users.length === 0 ? (
              <div className="empty-state">
                <strong>Nenhum usuário cadastrado</strong>
                <p>Cadastre usuários autorizados a acessar o sistema.</p>
              </div>
            ) : (
              <div className="contact-table-scroll">
                <table className="settings-table users-table">
                  <thead>
                    <tr>
                      <th>Usuário</th>
                      <th>Perfil</th>
                      <th>Permissão de exclusão</th>
                      <th>Situação</th>
                      <th aria-label="Ações" />
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((user) => (
                      <tr key={user.id}>
                        <td className="settings-name">{user.username}</td>
                        <td>{user.isAdmin ? "Administrador" : "Usuário"}</td>
                        <td>{user.canDelete ? "Permitida" : "Não permitida"}</td>
                        <td>
                          <span
                            className={`status-pill${user.isActive ? " active" : " inactive"}`}
                          >
                            {user.isActive ? "Ativo" : "Inativo"}
                          </span>
                        </td>
                        <td>
                          <div className="row-actions">
                            <button
                              aria-label={`Editar usuário ${user.username}`}
                              className="icon-button"
                              onClick={() => openForm(user)}
                              title="Editar usuário"
                              type="button"
                            >
                              <Icon name="edit" size={15} />
                            </button>
                            <button
                              aria-label={`${user.canDelete ? "Retirar" : "Conceder"} permissão de exclusão para ${user.username}`}
                              className="icon-button"
                              disabled={busyId === user.id}
                              onClick={() =>
                                void toggleDeletePermission(user)
                              }
                              title={
                                user.canDelete
                                  ? "Retirar permissão de exclusão"
                                  : "Conceder permissão de exclusão"
                              }
                              type="button"
                            >
                              <Icon
                                name={user.canDelete ? "deactivate" : "activate"}
                                size={15}
                              />
                            </button>
                            <button
                              aria-label={`${user.isActive ? "Desativar" : "Ativar"} usuário ${user.username}`}
                              className="icon-button"
                              disabled={busyId === user.id}
                              onClick={() => void toggleActive(user)}
                              title={user.isActive ? "Desativar" : "Ativar"}
                              type="button"
                            >
                              <Icon
                                name={user.isActive ? "deactivate" : "activate"}
                                size={15}
                              />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {isFormOpen && (
        <UserFormModal
          user={editingUser}
          onClose={() => setIsFormOpen(false)}
          onSave={saveUser}
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

function UserFormModal({
  user,
  onClose,
  onSave,
}: {
  user: AuthenticatedUser | null;
  onClose: () => void;
  onSave: (
    payload: CreateUserPayload | UpdateUserPayload,
  ) => Promise<void>;
}) {
  const [username, setUsername] = useState(user?.username ?? "");
  const [password, setPassword] = useState("");
  const [isAdmin, setIsAdmin] = useState(user?.isAdmin ?? false);
  const [canDelete, setCanDelete] = useState(user?.canDelete ?? false);
  const [isActive, setIsActive] = useState(user?.isActive ?? true);
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
    try {
      if (user) {
        const payload: UpdateUserPayload = {
          username: username.trim(),
          isAdmin,
          canDelete,
          isActive,
        };
        if (password) payload.password = password;
        await onSave(payload);
      } else {
        await onSave({
          username: username.trim(),
          password,
          isAdmin,
          canDelete,
          isActive,
        });
      }
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
        aria-labelledby="user-form-title"
        aria-modal="true"
        className="modal"
        role="dialog"
      >
        <header className="modal-header">
          <div>
            <h2 id="user-form-title">
              {user ? "Editar usuário" : "Novo usuário"}
            </h2>
            <p>Defina o perfil, o acesso e as permissões.</p>
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
              <label htmlFor="user-username">Usuário *</label>
              <input
                autoFocus
                autoComplete="username"
                id="user-username"
                maxLength={100}
                onChange={(event) => setUsername(event.target.value)}
                required
                value={username}
              />
            </div>
            <div className="form-field">
              <label htmlFor="user-password">
                Senha {user ? <span>· deixe em branco para manter</span> : "*"}
              </label>
              <input
                autoComplete="new-password"
                id="user-password"
                minLength={password || !user ? 8 : undefined}
                onChange={(event) => setPassword(event.target.value)}
                required={!user}
                type="password"
                value={password}
              />
            </div>
            <label className="user-permission-field">
              <input
                checked={isAdmin}
                onChange={(event) => setIsAdmin(event.target.checked)}
                type="checkbox"
              />
              <span>Administrador</span>
            </label>
            <label className="user-permission-field">
              <input
                checked={canDelete}
                onChange={(event) => setCanDelete(event.target.checked)}
                type="checkbox"
              />
              <span>Permitir exclusão de registros</span>
            </label>
            <label className="user-permission-field">
              <input
                checked={isActive}
                onChange={(event) => setIsActive(event.target.checked)}
                type="checkbox"
              />
              <span>Usuário ativo</span>
            </label>
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
              {isSaving ? "Salvando..." : "Salvar usuário"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
