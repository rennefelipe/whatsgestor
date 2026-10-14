"use client";
import { useState } from "react";
import { themes } from "./theme-storage";
import { useTheme } from "./theme-provider";
import { Icon } from "../icons";

export function AppearanceSettings() {
  const { theme, setTheme } = useTheme();
  const [notice, setNotice] = useState("");
  return (
    <section className="appearance-settings" aria-labelledby="appearance-title">
      <div className="appearance-heading">
        <div>
          <h2 id="appearance-title">Aparência</h2>
          <p>
            Personalize as cores. Esta preferência é salva neste navegador
            somente para o seu usuário.
          </p>
        </div>
        <Icon name="settings" size={22} />
      </div>
      <fieldset className="appearance-options">
        <legend className="visually-hidden">Tema do WhatsGestor</legend>
        {themes.map((option) => (
          <label key={option.id} className={"appearance-option " + option.id}>
            <input
              type="radio"
              name="appearance-theme"
              value={option.id}
              checked={theme === option.id}
              onChange={() =>
                setNotice(
                  setTheme(option.id)
                    ? "Tema " + option.label + " salvo para o seu usuário."
                    : "Tema aplicado nesta sessão. O navegador não permitiu salvar a preferência.",
                )
              }
            />
            <span className="appearance-preview" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
            <span className="appearance-option-copy">
              <strong>{option.label}</strong>
              <span>{option.description}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {notice && (
        <p className="appearance-notice" role="status">
          {notice}
        </p>
      )}
    </section>
  );
}
