# Preparação para publicação e instalação Windows — 03/11/2026

**Diagnóstico: preparação local concluída; instalação em SQL vazio ainda não homologada e implantação em produção não recomendada antes de tratar os alertas de dependências.** O usuário confirmou que não há instância SQL exclusiva de homologação disponível. Publicação depende de autorização final; nenhum push foi executado.

## Estrutura e dependências locais

Frontend Next.js 16.4.0/React 19.3.0 e backend NestJS 11, TypeORM 0.3 e SQL Server, com lockfiles independentes. A integração existente usa Baileys 7.0.0-rc14. Nenhuma dependência ou arquivo de aplicação foi alterado nesta preparação.

O backend exige host/porta/login/senha/nome do banco, configurações TLS, JWT e origens CORS. Lê `backend/.env` em caminho relativo à aplicação compilada. `HOST`/`PORT` são configuráveis; o instalador usa loopback e porta 3001. SQL integrado ao Windows não é suportado pela configuração atual; exige autenticação SQL. Instância nomeada pode ser resolvida pelo instalador via SQL Browser e persistida como host/porta TCP.

O frontend usa porta 3000 nos scripts npm e rewrite `/lan-api` para `127.0.0.1:3001`. O instalador configura `NEXT_PUBLIC_API_URL=/lan-api` antes do build. Alterar portas exige revisar rewrite, CORS, URL pública e proxy. Existe uma origem de desenvolvimento específica da máquina atual (`192.168.15.111`) em `next.config.ts`; não é requisito para produção em loopback/IIS, mas precisa de revisão caso o desenvolvimento em rede use outro endereço. Foi preservada.

Dados privados dependem de diretórios locais configuráveis: estado/chave de sessões, mídia e configurações de mensagens automáticas. O instalador gera diretórios exclusivos sob uma pasta escolhida fora do projeto. Configurações de mensagens automáticas são JSON privado; rascunhos de agendamento ficam no navegador, sem agendador SQL persistente implementado. Testes manuais de navegador possuem caminho fixo para Chrome, que pode não existir no outro computador. FFmpeg com libopus é necessário para os recursos de áudio, no PATH da conta que executa o backend.

## Banco e administrador

As migrations existentes foram preservadas:

1. `InitialSchema1793016000000`: 12 tabelas, índices, relacionamentos, checks e cinco configurações iniciais de exibição de contato.
2. `UserProfiles1793275200000`: nome/e-mail/perfil, preenchimento compatível com `isAdmin`, default e check de perfil.
3. `RecipientSelections1793390400000`: cinco tabelas de seleção de destinatários e seus índices/relacionamentos.

Total esperado: **17 tabelas de aplicação mais `whatsgestor_migrations`**. Testes offline comparam colunas das entidades e SQL congelado das migrations, verificam ordem, proteção de schema existente e bootstrap. Isso não comprova execução bem-sucedida de DDL em SQL Server real.

`synchronize`, `migrationsRun` e `dropSchema` permanecem desabilitados. Não há cópia do banco atual como requisito. O novo provisionador consulta `master` e cria o banco somente se ausente, escapando o identificador; antes das migrations, recusa schema sem histórico e migrations desconhecidas. O CLI existente aplica migrations e bootstrap sob transação/lock. Falha não apaga um banco criado anteriormente nem redefine dados.

O administrador é determinado por `isAdmin` e perfil efetivo `administrator`. O bootstrap existente cria usuário ativo com perfil administrador e permissão de exclusão, usando **bcrypt com custo 12** e senha nova fornecida pelo operador, de 12 caracteres ou mais e até 72 bytes UTF-8. Não usa senha/hash do administrador atual. A lógica de guards foi analisada; nenhum registro do banco atual foi consultado para comparar o ADM em uso.

O provisionador novo só chama bootstrap quando não há usuários. Havendo administrador ativo, preserva os usuários; havendo usuários sem administrador ativo, interrompe para revisão. Repetições não criam outro administrador nem redefinem senhas. O instalador completo recusa arquivos de ambiente existentes; não é um atualizador. Retomada de falhas está documentada.

## Entregas

- `scripts/install-windows.ps1`: pré-requisitos, prompts protegidos, dependências, builds, configuração SQL/instância, banco, migrations, administrador, verificação SQL/login e geração de ambientes/JWT. Arquivos privados usam ACL restrita à conta instaladora e SYSTEM.
- `backend/scripts/install-new.cjs`: criação condicional do banco, plano, migrations e bootstrap sem inicializar a aplicação.
- `backend/scripts/verify-install.cjs`: consulta tabelas/colunas/índices/constraints e autentica pelo `AuthService` real, conferindo perfil/permissões e rejeição de senha incorreta. Não cria Nest, sockets ou conexões WhatsApp. Não executado contra SQL nesta tarefa.
- `scripts/start-windows.ps1`: execução em primeiro plano do componente escolhido, com recusa de porta ocupada e sem encerramento/reinício de processos existentes.
- `.gitignore` e exportador: proteção adicional para NDF/TRN/SQLite/dumps e diretórios de credenciais; exemplos `.env.example` mantidos sem dados reais.
- [Instalação Windows](INSTALACAO-WINDOWS.md), [SQL](CONFIGURACAO-SQL-SERVER.md) e [IIS](DEPLOY-IIS.md): pré-requisitos, caminhos, configurações, recuperação de falhas e operação.

O instalador usa a credencial SQL fornecida também no ambiente de execução. Um DBA deve provisionar uma credencial de execução com privilégios mínimos antes da disponibilização. Não configura SQL Server, logins do servidor, serviços Windows, certificados, firewall ou IIS automaticamente. IIS é compatível como proxy ARR/URL Rewrite para os dois processos Node; funcionamento real de IIS/SSE/conta de serviço permanece pendente de homologação no destino.

## Validação executada nesta preparação

Execução em uma cópia isolada fora da instalação ativa, com dependências dos lockfiles (`npm ci --ignore-scripts`, seguido por `npm rebuild` antes dos testes/builds). Não foram recompilados os diretórios `dist`/`.next` da instalação atual.

| Verificação | Resultado real |
| --- | --- |
| Backend: build de produção executado pelo `pretest` | Passou |
| Backend: suíte `npm test` | 211 passaram, zero falhas/pulados |
| Backend: `npm run typecheck` | Passou |
| Novo provisionador: testes offline | 7 passaram, incluindo proteção do ambiente atual, repetição, schema desconhecido, senha, escape SQL e resolução de instância com doubles |
| Frontend: suíte `npm test` | 84 passaram, zero falhas/pulados |
| Frontend: build de produção e typecheck | Passaram |
| Frontend: lint | Passou, com 3 avisos em testes de navegador existentes |
| Exportador: testes de allowlist/exclusões e links | 3 passaram |
| PowerShell | Parser sem erros; `-PrepareOnly` passou na cópia e recusou o `.env` da instalação atual antes de qualquer ação |
| Escrita privada PowerShell | ACL protegida com duas regras, conteúdo preservado e sobrescrita recusada em arquivo fictício temporário |
| Frontend compilado servido em porta isolada | `/login` respondeu HTTP 200 com conteúdo WhatsGestor; processo de teste encerrado |

Total: **305 testes automatizados aprovados**, além das verificações descritas. A página de login acessível não comprova autenticação real no banco.

A comparação SHA-256 dos 315 arquivos previamente inventariados encontrou apenas as cinco alterações previstas em documentação, ignore e exportador; nenhum arquivo inventariado foi removido. Os 252 arquivos inventariados de frontend e fontes do backend permaneceram idênticos. Não houve alteração na lógica WhatsApp, nos ambientes reais ou nos serviços existentes.

O SQL Server da porta 1433 não foi acessado. Docker está instalado, mas seu daemon não está disponível; nenhum serviço foi iniciado para obtê-lo. Conforme confirmação do usuário, não há destino SQL isolado: **criação real do banco vazio, migrations reais, hash persistido no SQL, autenticação real do administrador, módulos com persistência SQL e repetição real do instalador estão pendentes**. Não houve testes ponta a ponta com banco, IIS ou navegador autenticado. Os scripts manuais de WhatsApp não foram executados; não houve envio real, pareamento ou uso de sessões atuais.

O comando legado `npm run test:sql` lê o ambiente configurado e alguns diagnósticos têm asserts anteriores ao schema atual (11 entidades/8 colunas de usuários). Não foi executado e não deve ser usado como homologação desta instalação sem revisão. Para o novo fluxo foi preparado `verify-install.cjs`, que exige configuração explícita e protege o alvo atual.

## Dependências e segurança de implantação

`npm audit --omit=dev` foi executado nos dois pacotes em 03/11/2026. A consulta inicial falhou por cadeia TLS local; a repetição usou CA local confiável fornecida ao processo, sem desligar validação TLS.

| Pacote | Contagem de pacotes afetados |
| --- | --- |
| Backend | 5 de severidade alta e 3 moderada |
| Frontend | 1 crítico (`next`) e 9 moderados |

São contagens da árvore de dependências, não necessariamente falhas independentes. A auditoria sugere Next 16.4.4 para o conjunto consultado. O mantenedor confirma falhas críticas em versões que incluem 16.4.0: [Cache Components](https://github.com/vercel/next.js/security/advisories/GHSA-673q-mjm6-r5xr) e [otimização de imagens SVG](https://github.com/vercel/next.js/security/advisories/GHSA-2464-fhr4-w9xw). Há também [DoS no body-parser](https://github.com/expressjs/body-parser/security/advisories/GHSA-27r3-jxmh-p828). A configuração atual habilita Cache Components; exploração específica não foi testada. Atualização e regressão são necessárias antes de recomendar produção. Nenhum `audit fix`, downgrade ou upgrade foi aplicado.

## Git, histórico e GitHub

O projeto ativo continua em `main`, com o commit original `9f3a86e`, muitas alterações anteriores (incluindo exclusões) e sem remoto configurado. Essas alterações foram preservadas; não houve staging, commit, reset ou limpeza na árvore ativa. Existem refs internas `refs/codex/...`, que não devem ser enviadas.

Foram examinados **705 objetos alcançáveis por todas as refs, sendo 544 blobs**. Não há caminhos de `.env` reais, credenciais de sessão, chaves ou arquivos de banco/backups no conjunto revisado. A comparação literal com os dois segredos dos ambientes locais não encontrou correspondências; 28 alertas de padrões no histórico foram revisados como fixtures e expressões de código. A exportação também foi examinada. Essa revisão reduz risco; não é garantia universal de ausência de segredos.

O exportador por allowlist preserva fontes/documentação/examples e exclui dados, sessões, ambientes, chaves, bancos, backups, diagnósticos, artefatos, dependências e builds. Substitui o telefone de exemplo já identificado na preparação anterior somente em arquivos de exemplo/teste da cópia exportada. Não modifica o frontend operacional. O manifesto SHA-256 permite revisar os bytes destinados à publicação.

Consulta autenticada ao GitHub confirmou [rennefelipe/whatsgestor](https://github.com/rennefelipe/whatsgestor) **privado e vazio**. Foi utilizada a credencial já existente no Git Credential Manager em memória, sem exibir token ou gravá-lo no projeto. Nenhum repositório foi criado ou alterado remotamente nesta tarefa. Primeiro push e qualquer ação no ambiente atual dependem da autorização final solicitada pelo usuário.

## Próximos passos

Disponibilizar SQL Server isolado para executar o roteiro real banco vazio → migrations → administrador → login → módulos/persistência → repetição. Tratar dependências vulneráveis com regressão, preservar a integração WhatsApp e homologar serviços/IIS no destino. Depois de revisar as evidências e pendências, autorizar expressamente a publicação privada. O ambiente atual não precisa ser reiniciado para essa revisão.
