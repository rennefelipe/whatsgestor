"use client";

import { useState, type FormEvent } from "react";
import { ApiRequestError } from "@/services/api/client";
import { useTheme } from "../appearance/theme-provider";
import { isTheme, themes } from "../appearance/theme-storage";
import { useAuth } from "./auth-provider";

export function LoginScreen() {
  const { login } = useAuth();
  const { theme, setTheme } = useTheme();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);
    try {
      await login(username.trim(), password);
    } catch (loginError) {
      if (loginError instanceof ApiRequestError && loginError.status === 401) {
        setError("Usuário ou senha inválidos.");
      } else {
        setError(
          loginError instanceof Error
            ? loginError.message
            : "Não foi possível iniciar a sessão.",
        );
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="login-page">
      <section aria-labelledby="login-title" className="login-panel">
        <div className="login-brand">
          <span className="login-brand-mark">W</span>
          <span>WhatsGestor</span>
        </div>
        <label className="login-appearance">
          <span>Aparência do login</span>
          <select
            value={theme}
            onChange={(event) => {
              if (isTheme(event.target.value)) setTheme(event.target.value);
            }}
          >
            {themes.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <p className="eyebrow">Acesso seguro</p>
        <h1 id="login-title">Bem-vindo de volta</h1>
        <p className="login-subtitle">
          Entre com seu usuário para acessar o WhatsGestor.
        </p>

        <form className="login-form" onSubmit={handleSubmit}>
          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}
          <div className="form-field">
            <label htmlFor="login-username">Usuário</label>
            <input
              autoComplete="username"
              autoFocus
              id="login-username"
              maxLength={100}
              onChange={(event) => setUsername(event.target.value)}
              required
              value={username}
            />
          </div>
          <div className="form-field">
            <label htmlFor="login-password">Senha</label>
            <input
              autoComplete="current-password"
              id="login-password"
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />
          </div>
          <button
            className="primary-button login-submit"
            disabled={isSubmitting}
            type="submit"
          >
            {isSubmitting ? "Entrando..." : "Entrar"}
          </button>
        </form>
        <p className="login-footnote">
          Acesso restrito a usuários autorizados.
        </p>
      </section>
      <aside aria-hidden="true" className="login-aside">
        <div className="login-aside-orb login-aside-orb-one" />
        <div className="login-aside-orb login-aside-orb-two" />
        <div className="login-aside-copy">
          <span>Relacionamentos mais próximos.</span>
          <strong>Gestão simples, conexão próxima.</strong>
        </div>
      </aside>
    </main>
  );
}
