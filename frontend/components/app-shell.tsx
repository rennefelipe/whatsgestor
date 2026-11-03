"use client";

import { useSyncExternalStore } from "react";
import {
  readSection,
  writeSection,
  subscribeSection,
} from "./section-navigation";
import type { Section } from "./section-navigation";
import {
  readSidebar,
  writeSidebar,
  subscribeSidebar,
} from "./sidebar-preference";
import { useAuth } from "./auth/auth-provider";
import { Icon } from "./icons";
import type { IconName } from "./icons";

export type { Section } from "./section-navigation";

export function AppShell({
  children,
  onSectionChange,
}: Readonly<{
  children: (
    section: Section,
    navigate: (section: Section) => void,
  ) => React.ReactNode;
  onSectionChange?: (section: Section) => void;
}>) {
  const storedSection = useSyncExternalStore(
    subscribeSection,
    readSection,
    () => "conversations" as Section,
  );
  const navigate = (next: Section) => {
    writeSection(next);
    onSectionChange?.(next);
  };
  const { user, logout } = useAuth();
  const section: Section = user?.role === "tester" ? "contacts" : storedSection;
  const collapsed = useSyncExternalStore(
    subscribeSidebar,
    () => readSidebar(user?.id),
    () => false,
  );

  const inSettings = section !== "conversations" && section !== "bulk-send";
  const items: { id: Section; label: string; icon: IconName }[] = user?.role === "tester"
    ? [{ id: "contacts", label: "Contatos", icon: "contacts" }]
    : [
      { id: "conversations", label: "Conversas", icon: "conversations" },
      { id: "bulk-send", label: "Envio em Lote", icon: "bulk-send" },
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
        <div className="sidebar-section-label">WhatsGestor</div>
        <nav className="nav-list" id="main-navigation">
          {items.map((item) => (
            <button
              aria-current={section === item.id || (item.id === "settings" && inSettings) ? "page" : undefined}
              aria-label={item.label}
              aria-describedby={`nav-tooltip-${item.id}`}
              title={item.label}
              className={`nav-item${section === item.id || (item.id === "settings" && inSettings) ? " active" : ""}`}
              key={item.id}
              onClick={() => {
                navigate(item.id);
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
                  <small>{user.role === "tester" ? "Testador" : user.isAdmin ? "Administrador" : "Atendente"}</small>
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
                <small>{user.role === "tester" ? "Testador" : user.isAdmin ? "Administrador" : "Atendente"}</small>
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

      <div className="workspace">
        {inSettings && section !== "settings" && user?.role !== "tester" && <div className="settings-back-bar"><button type="button" className="secondary-button" onClick={() => navigate("settings")}><span aria-hidden="true">←</span> Voltar às configurações</button></div>}
        {children(section, navigate)}
      </div>
    </div>
  );
}
