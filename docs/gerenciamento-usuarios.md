# Gerenciamento de usuários — 29/10/2026

**Atualização:** a evolução com nome, e-mail e Testador foi preparada em código e testada, com compatibilidade antes da aplicação. Consulte [o plano detalhado da etapa v2](plano-usuarios-v2.md). A migration operacional continua pendente de autorização; as pendências descritas abaixo registram a entrega inicial.

Implementação compatível com o SQL atual. A etapa de nome completo, e-mail e perfil Testador depende de autorização para evolução do esquema; não foi executada nem gerada migration nesta entrega.

## Análise e escopo

Consulta somente leitura confirmou `dbo.users`: `id`, `username` (100 caracteres, índice único), `passwordHash`, `isAdmin`, `canDelete`, `isActive`, `createdAt` e `updatedAt`. O administrador ativo encontrado foi `admin`. Nenhum hash, senha ou token foi consultado ou exposto no relatório.

O sistema já tinha `UsersManagement` em Configurações, serviços de cadastro/edição/ativação e os endpoints administrativos. Esta entrega amplia essa tela e adiciona acesso direto no menu lateral, sem criar outra autenticação.

Não foram modificados integração WhatsApp, Baileys, reconexão, credenciais, transporte, persistência de conversas ou componentes internos de Conversas. Nenhum serviço operacional foi reiniciado manualmente, mensagem real enviada, dado operacional alterado, migration aplicada ou acesso LAN ativado. Os testes usam mocks, diretórios temporários e servidores de teste locais em portas isoladas.

## Acesso e operação

1. Entre com uma conta administrativa existente. O administrador identificado é `admin`; sua senha permanece a existente.
2. Abra **Usuários** no menu lateral, ou acesse `http://localhost:3000/#users`. O caminho anterior **Configurações → Usuários** permanece disponível.
3. Use **Novo usuário**, informe login único, senha e confirmação, perfil e situação. Atendentes novos vêm sem exclusão de registros. A senha deve ter no mínimo oito caracteres e no máximo 72 bytes em UTF-8.
4. Use o lápis para editar login, perfil e permissões. Use **Redefinir senha** para trocar apenas a senha, com confirmação. As ações de ativar/desativar e conceder/retirar exclusão também pedem confirmação.
5. **Permissões** mostra os acessos efetivos. Administradores possuem exclusão pelo perfil, independentemente do campo `canDelete`.

A tela tem indicadores globais de ativos, inativos e administradores; pesquisa por login, filtros por perfil/situação, estados de carregamento/erro/vazio, confirmação de ações, notificações e layout responsivo. A tabela permite rolagem horizontal local em telas pequenas. O formulário contém controle de foco, Escape e retorno de foco ao fechar.

Os arquivos estão prontos para o carregamento normal da aplicação. Não foi feito reinício para forçar a aplicação das mudanças em processos já em execução.

## Perfis disponíveis

| Perfil | Permissões |
| --- | --- |
| Administrador (`isAdmin=true`) | Gerenciar usuários, perfis, senhas e situação; acesso operacional e exclusões. |
| Atendente (`isAdmin=false`) | Acessos operacionais existentes; sem acesso a `/users`; exclusões somente se `canDelete=true`. |
| Testador | Indisponível nesta etapa. Não cadastrar um atendente como se fosse testador: atendentes mantêm seus acessos operacionais. |

Não foram retiradas permissões operacionais existentes dos atendentes. As restrições de administrador para usuários e a proteção do último administrador ativo já estavam no backend e foram reaproveitadas, incluindo a transação com bloqueio de tabela. Senhas continuam com bcrypt, custo 12; consultas de usuários retornam a projeção pública existente, sem senha/hash.

## Autenticação e sessões

Permanecem `POST /auth/login`, `GET /auth/me`, o JWT HS256 e os endpoints `GET/POST /users`, `GET/PATCH /users/:id`, `PATCH /users/:id/active` e `PATCH /users/:id/delete-permission`.

JWTs novos recebem `userRevision` com o `updatedAt` do usuário. O guard global compara a revisão com o registro ativo consultado a cada requisição. Uma atualização persistida de usuário invalida as sessões anteriores dessa conta, inclusive após reativação ou reinício do servidor, sem revogação em memória e sem novas colunas. Alterações no próprio usuário encerram a sessão da interface após sucesso. A conferência é aplicada na próxima requisição autenticada; não encerra retroativamente operações que já estavam em execução.

JWTs antigos, sem revisão, continuam aceitos quando `updatedAt <= iat`. Como o `iat` antigo tem precisão de segundos, uma sessão antiga emitida no mesmo segundo da última gravação de usuário pode exigir novo login uma única vez. Essa verificação conservadora evita deixar um token antigo válido após redefinição de senha no mesmo segundo. Não houve troca do segredo JWT ou invalidação geral de contas.

## Pendência de banco — requer autorização antes de implementar

O SQL atual não permite armazenar nome completo ou e-mail, nem distinguir três perfis independentes. Não foram usados arquivos paralelos, login codificado ou combinações de `canDelete` para contornar essa limitação.

Proposta para uma etapa autorizada:

- Adicionar `fullName` (`nvarchar(200)`, inicialmente opcional para preservar contas antigas) e `email` (`nvarchar(254)`, opcional). Login permanece independente do e-mail.
- Adicionar `role` com valores `administrator`, `attendant` e `tester`, mantendo compatibilidade de `isAdmin`; migrar explicitamente administradores e usuários atuais para os dois primeiros valores, sem alterar suas senhas ou situação.
- Sincronizar `role` e `isAdmin` no backend, validar coerência e manter a proteção do último administrador.
- Criar política global de autorização para Testador com lista explícita de consultas permitidas. Bloquear escrita, envio de mensagens, campanhas, desconexão, exclusões, gerenciamento de usuários e configurações no servidor. Liberar apenas telas de consulta aprovadas e cobrir também endpoints indiretos e rotas GET com efeitos colaterais.
- Revisar o plano SQL, backup e rollback antes de aplicar qualquer migration. A autorização dessa etapa deve indicar se inclui somente preparar a migration ou também executá-la.

## Arquivos alterados nesta etapa

- `frontend/components/settings/users-management.tsx`: tela e formulário existentes.
- `frontend/components/app-shell.tsx`: menu administrativo e rótulo Atendente.
- `frontend/components/section-navigation.ts`: seção `users`.
- `frontend/components/contacts/contacts-screen.tsx`: apenas importação e montagem da seção Usuários no roteador de telas.
- `frontend/app/globals.css`: estilos específicos com as cores semânticas dos temas existentes.
- `backend/src/auth/auth.service.ts`: emissão de revisão no JWT.
- `backend/src/auth/guards/auth.guard.ts`: validação da revisão e compatibilidade com tokens antigos.
- `backend/test/auth-users.test.cjs`: regressões de sessão, senha e compatibilidade.
- `backend/test/helpers/registrations-fixture.cjs`, `backend/test/helpers/conversations-fixture.cjs`, `backend/test/recipient-selections.test.cjs`: tokens dos testes alinhados ao contrato novo, sem alterar lógica operacional.
- `frontend/tests/section-navigation.test.mjs`: navegação da nova seção.

Arquivos novos: `frontend/tests/browser-users.mjs` (interface real com API simulada) e este documento. Nenhuma dependência nova.

## Validação

Resultado final: 183/183 testes do backend e 77/77 testes do frontend aprovados. Typecheck e build de ambos aprovados, ESLint dos arquivos TypeScript alterados aprovado e teste de navegador da tela aprovado com API simulada. A revisão visual incluiu desktop e celular.

- Backend: `npm test` (build e suíte completa com mocks) e `npm run typecheck`.
- Frontend: `npm test`, `npm run typecheck` e `npm run build`.
- ESLint dos quatro componentes/arquivos TypeScript de navegação alterados.
- `cd frontend; node tests/browser-users.mjs`: valida indicadores, busca, filtros, cadastro, login duplicado, confirmação de senha, cancelamento de ação crítica, edição, redefinição enviando somente a senha, ativação/desativação, permissões, layout de 390 pixels e bloqueio visual de não administradores. Capturas ficam em `frontend/.next/users-qa/` até o próximo build.
- Backend verifica cadastro e hash bcrypt, entradas inválidas, duplicidade, edição, ativação, proteção do último administrador, bloqueio de atendentes, redefinição e revogação de JWTs, login existente e ausência de vazamento de hashes/erros SQL.

Não há teste de perfil Testador executável porque esse perfil ainda não existe no modelo autorizado. Nenhum teste de conectividade com escrita no SQL operacional foi executado.

## Backup e reversão

Os 12 arquivos preexistentes alterados foram copiados antes da edição para `artifacts/backup-users-20261029/`, preservando os caminhos relativos. O backup contém o estado que já existia no workspace, incluindo alterações anteriores à tarefa. Não usar `git reset` ou `git checkout` global: o projeto já tinha diversas mudanças locais.

Para reverter, após revisar eventuais alterações posteriores, copie cada arquivo desse backup de volta ao caminho relativo correspondente na raiz `C:\Projetos\whatsgestor`. Remova somente os dois arquivos novos listados acima caso também deseje retirar o teste e este documento. Nenhuma reversão de dados ou SQL é necessária. Rebuild e eventual reinício operacional devem ser feitos em etapa separada autorizada. Reverter a validação de revisão também retira a proteção nova de revogação de JWTs.
