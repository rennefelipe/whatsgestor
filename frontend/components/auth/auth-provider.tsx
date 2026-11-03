"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { ApiRequestError } from "@/services/api/client";
import { getCurrentUser, login as requestLogin } from "@/services/api/auth";
import {
  AUTH_EXPIRED_EVENT,
  clearAccessToken,
  getAccessToken,
  saveAccessToken,
} from "@/services/api/auth-session";
import type { AuthenticatedUser } from "@/types/api";

interface AuthContextValue {
  user: AuthenticatedUser | null;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<AuthenticatedUser>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [sessionError, setSessionError] = useState("");
  const [verificationAttempt, setVerificationAttempt] = useState(0);

  const clearSession = useCallback(() => {
    clearAccessToken();
    setUser(null);
    setSessionError("");
    setIsLoading(false);
  }, []);

  useEffect(() => {
    const onAuthenticationExpired = () => clearSession();
    window.addEventListener(AUTH_EXPIRED_EVENT, onAuthenticationExpired);

    void Promise.resolve().then(async () => {
      const token = getAccessToken();
      if (!token) {
        setSessionError("");
        setIsLoading(false);
        return;
      }
      try {
        const currentUser = await getCurrentUser();
        setUser(currentUser);
        setSessionError("");
      } catch (error) {
        if (error instanceof ApiRequestError && error.status === 401) {
          clearAccessToken();
        } else {
          setSessionError(
            error instanceof Error
              ? error.message
              : "Não foi possível validar a sessão.",
          );
        }
        setUser(null);
      } finally {
        setIsLoading(false);
      }
    });

    return () => {
      window.removeEventListener(
        AUTH_EXPIRED_EVENT,
        onAuthenticationExpired,
      );
    };
  }, [clearSession, verificationAttempt]);

  useEffect(() => {
    if (isLoading) return;
    if (!user && pathname !== "/login") {
      router.replace("/login");
    } else if (user && pathname === "/login") {
      router.replace("/");
    }
  }, [isLoading, pathname, router, user]);

  const login = useCallback(
    async (username: string, password: string) => {
      const response = await requestLogin(username, password);
      saveAccessToken(response.accessToken);
      try {
        const currentUser = await getCurrentUser();
        setUser(currentUser);
        setSessionError("");
      } catch (error) {
        setUser(null);
        if (error instanceof ApiRequestError && error.status === 401) {
          clearAccessToken();
        } else {
          setSessionError(
            error instanceof Error
              ? error.message
              : "Não foi possível validar a sessão.",
          );
        }
        throw error instanceof ApiRequestError
          ? error
          : new Error("Não foi possível validar a sessão.");
      }
    },
    [],
  );

  const refreshUser = useCallback(async () => {
    const currentUser = await getCurrentUser();
    setUser(currentUser);
    return currentUser;
  }, []);

  const logout = useCallback(() => {
    clearAccessToken();
    setUser(null);
    setSessionError("");
    router.replace("/login");
  }, [router]);

  const value = useMemo(
    () => ({ user, isLoading, login, logout, refreshUser }),
    [user, isLoading, login, logout, refreshUser],
  );

  if (!user && sessionError && getAccessToken()) {
    return (
      <main className="auth-loading">
        <div className="auth-session-error" role="alert">
          <strong>Não foi possível validar sua sessão</strong>
          <span>{sessionError}</span>
          <button
            className="primary-button"
            onClick={() => {
              setSessionError("");
              setIsLoading(true);
              setVerificationAttempt((attempt) => attempt + 1);
            }}
            type="button"
          >
            Tentar novamente
          </button>
          <button className="secondary-button" onClick={logout} type="button">
            Voltar ao login
          </button>
        </div>
      </main>
    );
  }

  if (isLoading || (!user && pathname !== "/login")) {
    return (
      <main className="auth-loading" role="status">
        <span className="auth-loading-mark">W</span>
        <span>Carregando sua sessão...</span>
      </main>
    );
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth deve ser utilizado dentro de AuthProvider.");
  }
  return context;
}
