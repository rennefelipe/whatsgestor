"use client";

import { useAuth } from "../auth/auth-provider";
import { Icon, type IconName } from "../icons";
import type { Section } from "../section-navigation";

export const settingsAreas: { id: Section; label: string; description: string; icon: IconName; admin?: boolean }[] = [
  { id: "contacts", label: "Contatos", description: "Cadastre responsáveis, telefones, lojas e seus vínculos.", icon: "contacts" },
  { id: "organizations", label: "Organizações", description: "Organize grupos empresariais, shoppings e unidades.", icon: "store" },
  { id: "organization-types", label: "Tipos de organização", description: "Defina as categorias utilizadas na estrutura organizacional.", icon: "settings" },
  { id: "contact-types", label: "Tipos de contato", description: "Cadastre funções e classificações dos contatos.", icon: "user" },
  { id: "contact-identification", label: "Identificação dos contatos", description: "Escolha quais informações aparecem nas conversas.", icon: "contacts" },
  { id: "users", label: "Usuários", description: "Gerencie acessos, perfis e permissões.", icon: "user", admin: true },
  { id: "whatsapp-connections", label: "Conexões WhatsApp", description: "Consulte as conexões e seus estados atuais.", icon: "whatsapp" },
  { id: "automatic-messages", label: "Mensagens automáticas", description: "Configure os modelos de mensagens por etapa.", icon: "conversations", admin: true },
  { id: "whatsapp-monitor", label: "Monitor WhatsApp", description: "Consulte o diagnóstico e o estado das conexões.", icon: "whatsapp", admin: true },
  { id: "appearance", label: "Aparência", description: "Personalize a apresentação visual do sistema.", icon: "settings" },
  { id: "data-exchange", label: "Importação e exportação", description: "Gerencie seus cadastros usando uma única planilha Excel.", icon: "bulk-send" },
];

export function SettingsHome({ navigate }: { navigate: (section: Section) => void }) {
  const { user } = useAuth();
  return <main className="main-content settings-content">
    <div className="page-heading"><div><p className="eyebrow">Sua operação, organizada</p><h1>Configurações</h1><p className="page-subtitle">Escolha uma área para gerenciar o WhatsGestor.</p></div></div>
    <div className="settings-card-grid">{settingsAreas.filter(area => !area.admin || user?.isAdmin).map(area =>
      <button key={area.id} type="button" className="settings-area-card" onClick={() => navigate(area.id)}>
        <span className="settings-area-icon"><Icon name={area.icon} size={22} /></span>
        <strong>{area.label}</strong><span>{area.description}</span><span className="settings-area-link">Abrir área →</span>
      </button>)}
    </div>
  </main>;
}
