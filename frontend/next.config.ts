import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["192.168.15.111"],
  devIndicators: false,
  // A navegação autenticada ocorre por hash. Valide desempenho instantâneo
  // somente nas rotas que optarem por isso; erros e alertas de segurança continuam visíveis.
  experimental: {
    instantInsights: { validationLevel: "manual-warning" },
  },
  cacheComponents: true,
  partialPrefetching: true,

  async rewrites() {
    return [
      {
        source: "/lan-api/:path*",
        destination: "http://127.0.0.1:3001/:path*",
      },
    ];
  },

  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
