# Evolução de usuários — plano para autorização

Data: 29/10/2026. Estado: código e migration preparados; nenhuma migration executada no SQL operacional. Este documento não autoriza sua execução.

## Situação confirmada por consultas somente leitura

- Banco configurado: `WhatsGestor`.
- `dbo.users` possui o esquema legado; nenhuma das colunas `fullName`, `email` ou `role` existe.
- Não existe `dbo.whatsgestor_migrations`. Não foi criado histórico nem marcada artificialmente uma baseline como aplicada.
- O administrador identificado na etapa anterior é `admin`. Esta evolução não troca seu login ou sua senha.
- O migrador geral continua recusando a criação inicial sobre banco existente sem baseline reconhecida. Não se deve executar `npm run db:migrate` para esta intervenção.

## Mudança SQL proposta

Migration: `UserProfiles1793275200000`, em `backend/src/database/migrations/1793275200000-UserProfiles.ts`, com métodos `up` e `down`.

| Campo | Tipo e regra | Contas existentes |
| --- | --- | --- |
| `fullName` | `nvarchar(200) NULL` | Mantido `NULL`, sem inventar nomes. Obrigatório no cadastro de novas contas pela aplicação após liberação. |
| `email` | `nvarchar(254) NULL` | Mantido `NULL`. Opcional, validado no backend quando informado. Não substitui o login. |
| `role` | `nvarchar(20) NOT NULL` | `administrator` para `isAdmin=1`; `attendant` para os demais. Nenhuma conta vira Testador automaticamente. |

Adicionados `DF_users_role_v2` e `CK_users_role_v2`. Os valores aceitos são `administrator`, `attendant` e `tester`. Testadores exigem `isAdmin=0` e `canDelete=0`. O valor `administrator` exige `isAdmin=1`.

O default `attendant` mantém compatibilidade com inserções legadas, inclusive o bootstrap administrativo existente: `isAdmin=1` continua prevalecendo para o perfil efetivo de Administrador quando o valor armazenado for `attendant`. A aplicação sincroniza ambos os campos em suas alterações. O valor `tester` sempre prevalece como restrito, mesmo diante de flags inconsistentes, e a constraint impede gravar essas inconsistências.

O `up` não modifica `id`, `username`, `passwordHash`, `isAdmin`, `canDelete`, `isActive`, datas ou vínculos existentes. Em particular, não atualiza `updatedAt`: a migration não invalida as revisões dos JWTs atuais. Não há remoção de usuários, nova autenticação ou alteração de segredo JWT. A regra já existente para tokens legados emitidos no mesmo segundo de uma atualização permanece a da entrega anterior.

## Permissões do Testador

Política aplicada por guard global, depois da autenticação e antes dos controllers, usando o perfil atual consultado no mesmo `dbo.users`. Não depende de perfil enviado no JWT ou de esconder botões.

| Permitido | Bloqueado |
| --- | --- |
| Consultar a própria sessão (`/auth/me`). | Gerenciar usuários, perfis e senhas de terceiros. |
| GET/HEAD de contatos, opções e detalhe por ID. | Qualquer escrita, ativação, desativação ou exclusão de contatos. |
| GET/HEAD de organizações, tipos de organização e tipos de contato. | Escrita em cadastros e configurações. |
| GET/HEAD das opções de exibição de contatos. | Mensagens, anexos, áudio, preparação/envio e campanhas. |
| Login existente e endpoints públicos de saúde. | Todas as rotas de conexões, QR, conexão/desconexão, recuperação e eventos WhatsApp. |
| Tela Contatos em modo de consulta, busca e filtros. | Conversas, monitor, lote, configurações e qualquer rota futura não explicitamente autorizada. |

O menu de Testador mostra somente Contatos. A tela oculta cadastro, edição, ativação e ações de campanha. O avatar usa iniciais e não consulta fotos do WhatsApp para esse perfil. Alterar o hash da URL não libera outra tela. Administradores e atendentes mantêm suas permissões existentes.

## Compatibilidade durante a preparação

O mapeamento ORM legado permanece intacto. `UsersProfileStore` detecta o conjunto de três colunas por consulta a `sys.columns` e só então acessa os campos novos, sempre com parâmetros SQL. Não cria tabelas ou colunas na inicialização.

Antes da migration, o login e os endpoints legados continuam funcionando com o contrato anterior. A tela não oferece os campos ou o perfil indisponível; requisições diretas tentando gravá-los recebem conflito. Um esquema com apenas parte das colunas é tratado como indisponível, sem converter silenciosamente Testador em atendente. O administrador pode consultar a disponibilidade por `GET /users/schema`.

Após a migration, nome e e-mail aparecem no formulário/listagem, a busca aceita nome e login e o filtro inclui Testador. Mudanças de perfil e dados persistidos continuam invalidando sessões da conta alterada pela revisão `updatedAt`. O backend grava perfil e flags atomicamente, dentro da transação, preservando constraints e a proteção do último administrador.

## Procedimento proposto — somente depois de autorização explícita

1. Confirmar a autorização para **backup do banco e aplicação apenas desta migration** no banco `WhatsGestor`. A autorização atual cobre preparação e testes, não execução operacional.
2. Definir uma janela de manutenção curta, sem reiniciar serviços e sem desconectar o WhatsApp. Evitar operações de gerenciamento de usuários durante a transação. Alterações de esquema exigem bloqueio e podem atrasar requisições dependentes de usuários; se houver bloqueio persistente, abortar e reagendar, sem parar a integração. Não prometer indisponibilidade zero.
3. Criar backup completo do banco pelo SQL Server, com nome exclusivo, `COPY_ONLY` e `CHECKSUM`, em caminho do servidor SQL previamente confirmado, com acesso restrito. Validar o arquivo por `RESTORE VERIFYONLY ... WITH CHECKSUM`; preferencialmente ensaiar restauração em banco isolado antes da intervenção. Nenhum caminho de backup no servidor foi presumido ou criado nesta etapa.
4. Guardar também versão dos arquivos, esquema, índices e constraints de `dbo.users`, contagem de usuários/administradores ativos e um comparativo protegido dos campos legados. Não imprimir hashes, senhas ou tokens. A comparação pré/pós deve demonstrar que identidade, credenciais, flags, datas e vínculos legados não mudaram.
5. Criar arquivo de configuração de manutenção separado do `.env` operacional, protegido e fora do repositório. Confirmar explicitamente host, porta e banco. A ferramenta exige `DB_NAME()` igual ao banco confirmado e recusa bancos de sistema, esquema legado incompatível e histórico desconhecido.
6. Executar o plano somente leitura do comando específico. Ele valida os oito campos legados e a concordância entre novas colunas e histórico. Revisar também o índice único de login e as constraints existentes com o inventário da etapa 4.
7. Aplicar **somente** `UserProfiles1793275200000` pelo executor específico, em transação `SERIALIZABLE`, com trava de manutenção e timeout de bloqueio de 10 segundos. Criar `dbo.whatsgestor_migrations` se necessário e registrar apenas a versão nova. A migration inicial **não será executada nem registrada como aplicada**. Em erro, reverter a transação e não tentar outros migradores.
8. Verificar a presença/tipos das três colunas, constraint/default, registro de versão, totais, permissões legadas e igualdade dos campos protegidos pré/pós. Confirmar que o login administrativo existente permanece válido sem redefinição. Não cadastrar usuários fictícios ou enviar mensagens no SQL operacional.
9. Confirmar a disponibilidade dos campos na tela e as respostas de autorização sem ações reais de WhatsApp. A detecção do esquema ocorre nas requisições, sem exigir reinício para reconhecer as colunas. Se algum processo ainda não tiver carregado o código preparado, planejar sua atualização separadamente e pedir autorização; não reiniciar automaticamente.

Comandos de referência, **não executados** (caminho de configuração é ilustrativo):

```powershell
cd C:\Projetos\whatsgestor\backend
node scripts/users-profiles.cjs plan --config C:\CaminhoProtegido\users-maintenance.env --database WhatsGestor --maintenance-approved

# Apenas após backup verificado e autorização operacional:
node scripts/users-profiles.cjs migrate --config C:\CaminhoProtegido\users-maintenance.env --database WhatsGestor --maintenance-approved --apply
```

O executor específico existe porque o banco não tem baseline. Ele não altera o comportamento protegido do migrador geral. Uma futura adoção integral do histórico de outras estruturas exige auditoria própria; não usar marcação fictícia da migration inicial.

## Reversão preparada

- Em falha durante o `up`, a transação reverte DDL, backfill e registro de versão.
- Após commit, o `down` é permitido somente se esta for a última migration registrada e se **não existir nenhum Testador, ativo ou inativo**. A verificação ocorre antes de arquivar ou remover colunas. Isso evita conceder permissões de atendente por downgrade. Caso existam testadores, a reversão fica bloqueada até uma reclassificação explicitamente autorizada ou outra estratégia revisada.
- O `down` cria/atualiza `dbo.users_profile_v2_rollback`, arquivando ID, nome, e-mail, perfil e data de arquivamento. Não arquiva senhas ou hashes. Depois remove apenas `CK_users_role_v2`, `DF_users_role_v2` e as três colunas novas, e retira o registro dessa versão do histórico. Usuários, credenciais e relações permanecem.
- O arquivo contém dados pessoais; manter as mesmas restrições de acesso e política de retenção do banco. Não apagar o arquivo lógico automaticamente. Reaplicar o `up` restaura nomes/e-mails para IDs ainda existentes e reconcilia o perfil com as flags atuais, sem alterar essas flags.
- O código preparado continua compatível com o esquema antigo depois do `down`. Se também for necessário reverter arquivos, comparar o backup desta etapa com mudanças posteriores antes de copiá-los. Não usar `git reset` global.
- Restaurar backup completo do banco é uma alternativa de último recurso: requer autorização separada, pois pode afetar dados de conversas e outras alterações ocorridas depois do backup. Não executá-la automaticamente.

Comando de referência de reversão, **não executado**:

```powershell
node scripts/users-profiles.cjs revert --config C:\CaminhoProtegido\users-maintenance.env --database WhatsGestor --maintenance-approved --apply
```

## Arquivos e backup de preparação

Backup prévio: `artifacts/backup-users-v2-20261029/`, preservando caminhos relativos. O manifest inclui hashes dos arquivos anteriores/atuais e os novos arquivos. Não contém `.env`, credenciais ou sessões. O backup da entrega anterior foi preservado.

Novos arquivos:

- `backend/src/database/migrations/1793275200000-UserProfiles.ts`
- `backend/src/users/user-profile.ts`
- `backend/src/users/users-profile.store.ts`
- `backend/src/users/dto/user-profile.dto.ts`
- `backend/src/auth/guards/tester-permission.guard.ts`
- `backend/scripts/users-profiles.cjs`
- `backend/test/users-schema.test.cjs`
- Este plano.

Arquivos alterados:

- Backend: serviço/módulo/controller de usuários, DTOs de criação/edição, registro de guard em `auth.module.ts`, registro de migration em `database/data-source.ts`, `package.json`, testes de autenticação e fixtures isoladas de cadastros/conversas/seleção.
- Frontend: tipos de API, serviço de usuários, tela/formulário de usuários, menu principal, montagem de Contatos e lista de Contatos, teste de navegador.
- Documento anterior de gerenciamento, com referência a esta evolução.

Não foram alterados entidade ORM legada de usuários, algoritmo de senha, configuração/segredo JWT, migrador geral, componentes internos de Conversas, Baileys, sessões, reconexão ou transporte WhatsApp. Nenhuma dependência nova foi instalada.

## Resultados dos testes

- **192/192 testes do backend aprovados**, incluindo 15 de autenticação/usuários e 5 de migration/manutenção específica.
- **77/77 testes do frontend aprovados**.
- Typecheck e build de ambos aprovados; ESLint dos seis arquivos TypeScript/TSX do frontend alterados aprovado.
- Teste de navegador com API simulada aprovado: nome, e-mail opcional, perfil Testador, busca/filtros, cadastro, duplicidade, senha, edição, redefinição, ativação, restrição do menu e tabela somente leitura para Testador, compatibilidade antes da migration, desktop e celular.
- Simulação de `up → down → up` preservou usuários/senhas/revisões e recuperou nomes/e-mails arquivados. Testes bloquearam rollback com Testador, repetição de migration, schema parcial, falta de autorização e histórico desconhecido. O comando específico aplicou somente a migration de usuários no simulador.
- A proteção HTTP foi testada com o guard real e controllers de prova sem efeitos externos. Nenhum endpoint de envio real foi chamado.

Os testes de migration são simulados; DDL não foi executado em uma instância SQL Server. Antes da aplicação operacional, recomenda-se ensaio em cópia isolada restaurada do backup, conforme os passos acima. O plano não inclui ativação LAN ou reinício de serviços.
