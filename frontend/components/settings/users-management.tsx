"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  createUser,
  getUsers,
  getUsersSchema,
  updateUser,
  updateUserActive,
  updateUserDeletePermission,
} from "@/services/api/users";
import type {
  AuthenticatedUser,
  CreateUserPayload,
  UpdateUserPayload,
  UserRole,
} from "@/types/api";
import { useAuth } from "../auth/auth-provider";
import { Icon } from "../icons";

function getErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Não foi possível concluir a operação.";
}

export function UsersManagement() {
  const { user: currentUser, logout } = useAuth();
  const [users, setUsers] = useState<AuthenticatedUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [toastMessage, setToastMessage] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingUser, setEditingUser] = useState<AuthenticatedUser | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [resetOnly, setResetOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [profile, setProfile] = useState("");
  const [profileFieldsAvailable, setProfileFieldsAvailable] = useState(false);
  const [status, setStatus] = useState("");
  const [permissionsUser, setPermissionsUser] = useState<AuthenticatedUser | null>(null);
  const visibleUsers = users.filter((entry) =>
    `${entry.fullName ?? ""} ${entry.username}`.toLocaleLowerCase("pt-BR").includes(search.trim().toLocaleLowerCase("pt-BR")) &&
    (!profile || (entry.role ?? (entry.isAdmin ? "administrator" : "attendant")) === profile) &&
    (!status || entry.isActive === (status === "active")));
  const activeAdmins = users.filter((entry) => entry.isAdmin && entry.isActive).length;

  const loadUsers = useCallback(async (signal?: AbortSignal) => {
    setIsLoading(true);
    setLoadError("");
    try {
      const [result, schema] = await Promise.all([getUsers(signal), getUsersSchema(signal)]);
      if (signal?.aborted) return;
      setUsers(result);
      setProfileFieldsAvailable(schema.profileFieldsAvailable === true);
      setPermissionsUser((previous) => previous ? result.find((entry) => entry.id === previous.id) ?? null : null);
    } catch (error) {
      if (!signal?.aborted) setLoadError(getErrorMessage(error));
    } finally {
      if (!signal?.aborted) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(() => {
      if (!controller.signal.aborted && currentUser?.isAdmin) void loadUsers(controller.signal);
    });
    return () => controller.abort();
  }, [loadUsers, currentUser?.isAdmin]);

  useEffect(() => {
    if (!toastMessage) return;
    const timer = window.setTimeout(() => setToastMessage(""), 3200);
    return () => window.clearTimeout(timer);
  }, [toastMessage]);

  function openForm(user: AuthenticatedUser | null, passwordOnly = false) {
    setResetOnly(passwordOnly);
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
        logout();
        return;
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
    if (!window.confirm(`${user.isActive ? "Desativar" : "Ativar"} o usuário ${user.username}? ${user.isActive ? "O acesso será bloqueado imediatamente." : "O usuário poderá entrar novamente."}`)) return;
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
    if (!window.confirm(`${user.canDelete ? "Retirar" : "Conceder"} permissão de exclusão para ${user.username}?`)) return;
    setBusyId(user.id);
    setActionError("");
    try {
      await updateUserDeletePermission(user.id, !user.canDelete);
      if (user.id === currentUser?.id) { logout(); return; }
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

  if (!currentUser?.isAdmin) return <div className="inline-error" role="alert">Acesso restrito a administradores.</div>;

  return (
    <>
      <div className="users-management">
        <div className="users-management-heading">
          <div>
            <h1>Usuários</h1>
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

        <div className="users-stats" aria-label="Indicadores de usuários">
          <article className="users-stat users-stat-active"><span>Ativos</span><strong>{isLoading || loadError ? "—" : users.filter((entry) => entry.isActive).length}</strong></article>
          <article className="users-stat users-stat-inactive"><span>Inativos</span><strong>{isLoading || loadError ? "—" : users.filter((entry) => !entry.isActive).length}</strong></article>
          <article className="users-stat users-stat-admin"><span>Administradores</span><strong>{isLoading || loadError ? "—" : users.filter((entry) => entry.isAdmin).length}</strong><small>{isLoading || loadError ? "" : `${activeAdmins} com acesso ativo`}</small></article>
        </div>
        {!isLoading && !loadError && !profileFieldsAvailable && <p>Nome completo, e-mail e perfil Testador aguardam liberação administrativa.</p>}
        <div className="users-filters">
          <label className="form-field">Buscar por nome ou login<input type="search" placeholder="Digite o nome ou login…" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
          <label className="form-field">Perfil<select value={profile} onChange={(event) => setProfile(event.target.value)}><option value="">Todos os perfis</option><option value="administrator">Administrador</option><option value="attendant">Atendente</option>{profileFieldsAvailable && <option value="tester">Testador</option>}</select></label>
          <label className="form-field">Situação<select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">Todas as situações</option><option value="active">Ativo</option><option value="inactive">Inativo</option></select></label>
        </div>
        {permissionsUser && <section className="users-permissions" aria-label={`Permissões de ${permissionsUser.username}`}>
          <strong>Permissões de {permissionsUser.username}</strong>
          <p>{permissionsUser.role === "tester" ? "Testador: somente consulta de contatos e cadastros de apoio. Sem envios, campanhas, acesso ao WhatsApp, exclusões, alterações de configurações ou gerenciamento de usuários." : permissionsUser.isAdmin ? "Administrador: gerenciamento de usuários e configurações administrativas, acesso operacional e exclusões." : `Atendente: acesso operacional a conversas, contatos e rotinas disponíveis. Sem gerenciamento de usuários. Exclusões ${permissionsUser.canDelete ? "autorizadas" : "bloqueadas"}.`}</p>
          <p>{permissionsUser.isActive ? "Acesso ativo." : "Acesso bloqueado: usuário inativo."}</p>
          <button type="button" className="secondary-button" onClick={() => setPermissionsUser(null)}>Fechar permissões</button>
        </section>}
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
            {visibleUsers.length === 0 ? (
              <div className="empty-state">
                <strong>Nenhum usuário encontrado</strong>
                <p>Revise os filtros ou cadastre um usuário autorizado.</p>
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
                    {visibleUsers.map((user) => (
                      <tr key={user.id}>
                        <td className="settings-name"><strong>{user.fullName || user.username}</strong>{user.fullName && <div>{user.username}</div>}{user.email && <small>{user.email}</small>}</td>
                        <td>{user.role === "tester" ? "Testador" : user.isAdmin ? "Administrador" : "Atendente"}</td>
                        <td>{user.isAdmin ? "Incluída no perfil" : user.canDelete ? "Permitida" : "Não permitida"}</td>
                        <td>
                          <span
                            className={`status-pill${user.isActive ? " active" : " inactive"}`}
                          >
                            {user.isActive ? "Ativo" : "Inativo"}
                          </span>
                        </td>
                        <td>
                          <div className="row-actions">
                            <button type="button" className="secondary-button" aria-label={`Permissões de ${user.username}`} onClick={() => setPermissionsUser(user)}>Permissões</button>
                            <button type="button" className="secondary-button" aria-label={`Redefinir senha de ${user.username}`} disabled={busyId !== null} onClick={() => openForm(user, true)}>Redefinir senha</button>
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
                              disabled={busyId !== null || user.isAdmin || user.role === "tester"}
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
                              disabled={busyId !== null || (user.isAdmin && user.isActive && activeAdmins <= 1)}
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
          resetOnly={resetOnly}
          profileFieldsAvailable={profileFieldsAvailable}
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
  resetOnly,
  profileFieldsAvailable,
  onClose,
  onSave,
}: {
  user: AuthenticatedUser | null;
  resetOnly: boolean;
  profileFieldsAvailable: boolean;
  onClose: () => void;
  onSave: (
    payload: CreateUserPayload | UpdateUserPayload,
  ) => Promise<void>;
}) {
  const [username, setUsername] = useState(user?.username ?? "");
  const [fullName, setFullName] = useState(user?.fullName ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [role, setRole] = useState<UserRole>(user?.role ?? (user?.isAdmin ? "administrator" : "attendant"));
  const isAdmin = role === "administrator";
  const [canDelete, setCanDelete] = useState(user?.canDelete ?? false);
  const [isActive, setIsActive] = useState(user?.isActive ?? true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const modalRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const modal = modalRef.current;
    modal?.querySelector<HTMLElement>(resetOnly ? '#user-password' : '#user-username')?.focus();
    function trapFocus(event: KeyboardEvent) {
      if (event.key !== 'Tab' || !modal) return;
      const controls = [...modal.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled)')];
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
    document.addEventListener('keydown', trapFocus);
    return () => { document.removeEventListener('keydown', trapFocus); previous?.focus(); };
  }, [resetOnly]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !isSaving) onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isSaving, onClose]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSaving) return;
    setError("");
    if ((!user || resetOnly) && (password !== confirmation || password.length < 8 || new TextEncoder().encode(password).length > 72)) {
      setError("As senhas devem coincidir e ter pelo menos 8 caracteres e no máximo 72 bytes em UTF-8.");
      return;
    }
    if (user && !window.confirm(resetOnly ? `Redefinir a senha de ${user.username}? Será necessário entrar novamente.` : `Salvar as alterações de ${user.username}? As sessões deste usuário serão invalidadas.`)) return;
    setIsSaving(true);
    try {
      const profileData = profileFieldsAvailable ? { fullName: fullName.trim() || undefined, email: email.trim() || null, role } : {};
      if (user) {
        const payload: UpdateUserPayload = {
          ...profileData,
          username: username.trim(),
          isAdmin,
          canDelete,
          isActive,
        };
        await onSave(resetOnly ? { password } : payload);
      } else {
        await onSave({
          ...profileData,
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
        ref={modalRef}
        aria-labelledby="user-form-title"
        aria-modal="true"
        className="modal"
        role="dialog"
      >
        <header className="modal-header">
          <div>
            <h2 id="user-form-title">
              {resetOnly ? `Redefinir senha: ${user?.username}` : user ? "Editar usuário" : "Novo usuário"}
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
            {!resetOnly && profileFieldsAvailable && <>
              <div className="form-field"><label htmlFor="user-full-name">Nome completo{!user && " *"}</label><input id="user-full-name" autoComplete="name" maxLength={200} required={!user} value={fullName} onChange={(event) => setFullName(event.target.value)} /></div>
              <div className="form-field"><label htmlFor="user-email">E-mail (opcional)</label><input id="user-email" type="email" autoComplete="email" maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} /></div>
            </>}
            {!resetOnly && <div className="form-field">
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
            </div>}
            {(!user || resetOnly) && <><div className="form-field">
              <label htmlFor="user-password">
                {resetOnly ? "Nova senha *" : "Senha inicial *"}
              </label>
              <input
                autoComplete="new-password"
                id="user-password"
                minLength={8}
                onChange={(event) => setPassword(event.target.value)}
                required
                type="password"
                value={password}
              />
            </div>
            <div className="form-field"><label htmlFor="user-password-confirmation">Confirmar senha *</label><input id="user-password-confirmation" autoComplete="new-password" type="password" required value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></div></>}
            {!resetOnly && <><div className="form-field"><label htmlFor="user-profile">Perfil</label><select id="user-profile" value={role} onChange={(event) => { const next = event.target.value as UserRole; setRole(next); if (next === "tester") setCanDelete(false); }}><option value="attendant">Atendente</option><option value="administrator">Administrador</option>{profileFieldsAvailable && <option value="tester">Testador</option>}</select></div>
            {role === "tester" && <p>Somente consultas de contatos. Envio de mensagens, campanhas, WhatsApp, exclusões e alterações estão bloqueados no servidor.</p>}
            <label className="user-permission-field">
              <input
                checked={canDelete}
                disabled={role === "tester"}
                onChange={(event) => setCanDelete(event.target.checked)}
                type="checkbox"
              />
              <span>{isAdmin ? "Permitir exclusões caso passe a atendente" : "Permitir exclusão de registros"}</span>
            </label>
            <label className="user-permission-field">
              <input
                checked={isActive}
                onChange={(event) => setIsActive(event.target.checked)}
                type="checkbox"
              />
              <span>Usuário ativo</span>
            </label></>}
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
              {isSaving ? "Salvando..." : resetOnly ? "Redefinir senha" : "Salvar usuário"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
