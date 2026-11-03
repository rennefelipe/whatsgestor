# WhatsGestor

Gestão de contatos e atendimento WhatsApp com frontend Next.js/React, backend NestJS e SQL Server. Inclui hierarquia de organizações, contatos, identificação, perfis, Excel e seleção de destinatários.

O repositório distribui código e exemplos. Banco, credenciais, mensagens, mídias e sessões pertencem a cada instalação.

## Requisitos

Windows, Git, Node.js **22 LTS com patch de segurança atual**, npm e SQL Server com TCP/IP e autenticação SQL. Para áudio, FFmpeg com libopus no PATH da conta do serviço. Consulte o [ciclo oficial do Node.js](https://nodejs.org/en/about/previous-releases).

Versões dos lockfiles: Next 16.4.0, React 19.3.0, NestJS 11, TypeORM 0.3 e Baileys 7.0.0-rc14. Preserve ambos os `package-lock.json`; não executar `npm update` ou `npm audit fix` como parte da instalação.

## Instalação e operação

Preparação atual: [relatório de 03/11/2026](docs/PREPARACAO-PUBLICACAO-2026-11-03.md). Em um clone novo no computador de destino, `powershell.exe -NoProfile -File scripts/install-windows.ps1` automatiza dependências, banco, migrations, administrador e builds. Consulte os pré-requisitos e limites no roteiro abaixo.

- [Instalação Windows desde o clone até o login](docs/INSTALACAO-WINDOWS.md).
- [SQL Server, migrations e administrador inicial](docs/CONFIGURACAO-SQL-SERVER.md).
- [Atualização e publicação privada](docs/ATUALIZACAO.md).
- [Backup e restauração](docs/BACKUP-RESTAURACAO.md).
- [Proxy HTTPS com IIS](docs/DEPLOY-IIS.md).
- [Evidências e pendências desta preparação](docs/PREPARACAO-GITHUB.md).

Não iniciar outra instância usando banco e estado WhatsApp da instalação ativa.

## Compilar e verificar

Em cada pacote: `npm ci` e `npm run build`. No backend: `npm run typecheck` e `npm test`. No frontend: `npm test`, `npm run build` e depois `npm run typecheck` (o build gera tipos de rotas). Na raiz: `node --test scripts/prepare-release.test.cjs`.

Os testes offline adicionais do instalador executam com `node --test test/install-new.test.cjs` no backend. A verificação SQL real usa `scripts/verify-install.cjs` com arquivo de configuração explícito e senha em variável de processo, conforme o roteiro Windows; ela não inicializa a integração WhatsApp.

O backend inicia com `npm run start:prod` no diretório `backend`; frontend com `npm run start` em `frontend`. O backend exige SQL e migrations concluídas. `npm run test:sql` acessa o banco configurado: executar somente em homologação explicitamente isolada.

## Persistência e limites

As três migrations definem 17 tabelas de aplicação, além de `whatsgestor_migrations`: usuários/perfis, tipos/hierarquia, contatos, identificação/preferências, histórico de conexão/conversa/mensagem/mídia e cinco tabelas de seleção de destinatários. Sincronização de schema, migrations no startup e `dropSchema` ficam desabilitados.

Prévias Excel são temporárias em memória; a confirmação grava nos cadastros existentes. Configurações de mensagens automáticas ficam em JSON privado (`APP_SETTINGS_DIRECTORY`), sem disparo automático implementado. Rascunhos de agendamento ficam no navegador; esta versão não tem agendador de disparos persistido no SQL.

Build e testes offline não equivalem à homologação em banco vazio. Consulte o relatório antes de promover uma instalação nova.
