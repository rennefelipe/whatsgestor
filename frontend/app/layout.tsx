import type { Metadata } from "next";
import { AuthProvider } from "@/components/auth/auth-provider";
import { ThemeProvider } from "@/components/appearance/theme-provider";
import { THEME_BOOTSTRAP_SCRIPT } from "@/components/appearance/theme-storage";
import "./globals.css";
import "./themes.css";

export const metadata: Metadata = {
  title: "WhatsGestor | Contatos",
  description: "Gestão de contatos do WhatsGestor.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR" data-theme="white" suppressHydrationWarning>
      <head>
        <script
          id="whatsgestor-theme"
          dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }}
        />
      </head>
      <body>
        <AuthProvider>
          <ThemeProvider>{children}</ThemeProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
