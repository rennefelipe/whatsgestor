"use client";

import { useState, useSyncExternalStore } from "react";
import {
  readSidebar,
  writeSidebar,
  subscribeSidebar,
} from "./sidebar-preference";
import { useAuth } from "./auth/auth-provider";
import { Icon } from "./icons";
import type { IconName } from "./icons";

export type Section =
  "contacts" | "settings" | "whatsapp-connections" | "conversations";

export function AppShell({
  children,
  onSectionChange,
}: Readonly<{
  children: (section: Section) => React.ReactNode;
  onSectionChange?: (section: Section) => void;
}>) {
  const [section, setSection] = useState<Section>("contacts");
  const { user, logout } = useAuth();
  const collapsed = useSyncExternalStore(
    subscribeSidebar,
    () => readSidebar(user?.id),
    () => false,
  );

  const items: { id: Section; label: string; icon: IconName }[] = [
    { id: "contacts", label: "Contatos", icon: "contacts" },
    {
      id: "whatsapp-connections",
      label: "Conexões WhatsApp",
      icon: "whatsapp",
    },
    { id: "conversations", label: "Conversas", icon: "conversations" },
    { id: "settings", label: "Configurações", icon: "settings" },
  ];

  return (
    <div
      className={`app-shell${section === "conversations" ? " conversations-shell" : ""}${collapsed ? " sidebar-collapsed" : ""}`}
    >
      <aside
        className="sidebar"
        aria-label="Navegação principal"
        id="main-sidebar"
      >
        <div className="brand">
          <span className="brand-mark">
            <Icon name="contacts" size={18} />
          </span>
          <span className="brand-wordmark">WhatsGestor</span>
        </div>
        <button
          className="sidebar-toggle"
          type="button"
          aria-controls="main-navigation"
          aria-expanded={!collapsed}
          aria-label={
            collapsed ? "Expandir menu lateral" : "Recolher menu lateral"
          }
          title={collapsed ? "Expandir menu lateral" : "Recolher menu lateral"}
          onClick={() => user && writeSidebar(user.id, !collapsed)}
        >
          <span aria-hidden="true">{collapsed ? "›" : "‹"}</span>
          <span className="sidebar-toggle-label">Recolher menu</span>
        </button>
        <div className="sidebar-section-label">Workspace</div>
        <nav className="nav-list" id="main-navigation">
          {items.map((item) => (
            <button
              aria-current={section === item.id ? "page" : undefined}
              aria-label={item.label}
              aria-describedby={`nav-tooltip-${item.id}`}
              title={item.label}
              className={`nav-item${section === item.id ? " active" : ""}`}
              key={item.id}
              onClick={() => {
                setSection(item.id);
                onSectionChange?.(item.id);
              }}
              type="button"
            >
              <Icon name={item.icon} size={17} />
              <span className="nav-label">{item.label}</span>
              <span
                className="nav-tooltip"
                role="tooltip"
                id={`nav-tooltip-${item.id}`}
              >
                {item.label}
              </span>
            </button>
          ))}
        </nav>

        {user && (
          <div className="sidebar-account">
            <div className="sidebar-account-card">
              <div className="sidebar-account-row">
                <Icon name="user" size={20} />
                <span className="sidebar-account-label">
                  <strong title={user.username}>{user.username}</strong>
                  <small>{user.isAdmin ? "Administrador" : "Usuário"}</small>
                </span>
              </div>
              <button
                type="button"
                className="secondary-button sidebar-account-logout"
                onClick={logout}
              >
                <Icon name="logout" size={18} /> Sair
              </button>
            </div>
            <details
              className="sidebar-account-disclosure"
              key={collapsed ? "collapsed" : "expanded"}
            >
              <summary
                aria-label={`Conta de ${user.username}`}
                title={`Conta de ${user.username}`}
              >
                <Icon name="user" size={20} />
              </summary>
              <div className="sidebar-account-menu">
                <strong>{user.username}</strong>
                <small>{user.isAdmin ? "Administrador" : "Usuário"}</small>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={logout}
                >
                  <Icon name="logout" size={18} /> Sair
                </button>
              </div>
            </details>
          </div>
        )}
      </aside>

      <div className="workspace">{children(section)}</div>
    </div>
  );
}
