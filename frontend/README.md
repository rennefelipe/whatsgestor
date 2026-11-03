# WhatsGestor frontend - v1.0.0

Interface Next.js 16.4.0 / React 19.3.0. Consulte o [README principal](../README.md) e o [guia Windows](../docs/INSTALACAO-WINDOWS.md).

Configure .env.local a partir de .env.example com a origem publica da API antes do build. Execute npm run build e npm run start -- --hostname 127.0.0.1 para servir a versao compilada na porta 3000, com gerenciamento externo do processo e proxy HTTPS. A API e um processo separado; a aplicacao nao e um site estatico exportavel.

Validacao isolada: npm run typecheck, npm run build, npm run lint e npm test. Os scripts tests/browser-*.mjs usam Chrome local e API simulada. Nao execute builds/testes no diretorio de uma instancia ativa. Veja requisitos e resultados no relatorio de preparacao da versao.
