"use client";
import {
  createContext,
  useContext,
  useCallback,
  useLayoutEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useAuth } from "../auth/auth-provider";
import {
  PUBLIC_THEME_ID,
  readTheme,
  writeTheme,
  subscribeToTheme,
  type Theme,
} from "./theme-storage";

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => boolean;
}
const ThemeContext = createContext<ThemeContextValue | null>(null);
export function ThemeProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const snapshot = useCallback(() => readTheme(userId), [userId]);
  const theme = useSyncExternalStore(
    subscribeToTheme,
    snapshot,
    () => "white" as Theme,
  );
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = readTheme(userId);
  }, [userId, theme]);
  const setTheme = useCallback(
    (value: Theme) => writeTheme(userId ?? PUBLIC_THEME_ID, value),
    [userId],
  );
  const context = useMemo(() => ({ theme, setTheme }), [theme, setTheme]);
  return (
    <ThemeContext.Provider value={context}>{children}</ThemeContext.Provider>
  );
}
export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context)
    throw new Error("useTheme deve ser utilizado dentro de ThemeProvider.");
  return context;
}
