# Preparação GitHub e instalação Windows — 30/10/2026

Destino solicitado: repositório **privado** `rennefelipe/whatsgestor`. Primeiro push depende de autorização expressa após apresentação dos resultados. Nenhum push foi executado nesta preparação.

## Correções de instalação

- Migration adicional imutável `RecipientSelections1793390400000`: cinco tabelas que existiam nas entidades mas faltavam no fluxo de instalação vazio; 21 comandos SQL gerados offline, com índices, checks e FKs. Não altera tabelas de mensagens/conversas/conexões.
- Bootstrap inicial insere explicitamente nome e perfil `administrator`, preservando bcrypt, transação, recusa de usuários existentes e exigência de migrations concluídas.
- Exemplo e script de criação usam o banco novo `WhatsGestor`. Exemplos não contêm credenciais reais. Não foram modificados ambientes operacionais.
- README e roteiros Windows/SQL/atualização documentam ordem dos passos, autenticação GitHub, permissões SQL, senha temporária protegida, build, login e nova instância sem copiar sessões.

## Segurança e escopo

O histórico original tinha um commit em `main` e refs internas de ferramentas. Foram examinados 685 objetos alcançáveis, caminhos sensíveis e padrões de credenciais. A comparação com os dois valores secretos presentes nos ambientes locais não encontrou correspondências. Os achados de padrões foram revisados como placeholders, código e fixtures; o telefone fornecido como exemplo no pedido foi anonimizado somente na cópia destinada à publicação. A inspeção reduz risco, mas não é garantia universal de ausência de informação sensível.

A exportação por allowlist exclui `.env` reais, sessões/credenciais WhatsApp, chaves/certificados, mídia/uploads, dados privados, JSON de configuração operacional, bancos/backups, planilhas exportadas, logs, diagnósticos locais, `artifacts`, `backend-backup`, dependências e builds. Gera manifesto SHA-256. Nada disso foi removido do computador atual.

Não publicar refs internas: somente o histórico revisado de `main`. A cópia de revisão fica fora da instalação; não usar staging amplo na árvore ativa. O telefone de exemplo é substituído em quatro arquivos de ajuda/testes da cópia, sem editar a interface operacional ou a lógica WhatsApp.

## Validação

As dependências foram instaladas de fato em diretório temporário com cache npm inicialmente vazio: 360 pacotes no backend e 456 no frontend, usando os lockfiles e verificação TLS. Houve avisos de dependências transitivas descontinuadas; não foram atualizadas automaticamente.

- Backend compilado; 12 testes focados de migrations, perfis e bootstrap passaram. Resultado da suíte completa será registrado ao concluir.
- Frontend: build de produção e typecheck concluídos; 84 testes passaram. A primeira tentativa de build foi interrompida pelo aviso de segurança do Next; a repetição concluiu, sem corrigir a vulnerabilidade.
- Produção frontend iniciada somente na cópia isolada, em porta livre 55084: `/login` respondeu HTTP 200 com conteúdo WhatsGestor. O processo de teste foi encerrado; nenhum backend foi iniciado. Isso não valida login/autenticação com SQL.
- Exportação: três testes passaram (allowlist/exclusões, anonimização de exemplo e recusa de links).
- Os 142 arquivos protegidos de lógica WhatsApp, autenticação/configuração operacional, frontend e ambientes reais permaneceram com SHA-256 idêntico ao início desta tarefa. Somente a cópia exportada recebe a troca do telefone de exemplo.

## Dependências com alertas de segurança

`npm audit --omit=dev` na cópia isolada reportou **cinco pacotes com severidade alta no backend**: `@azure/identity`, `@azure/msal-node`, `@nestjs/platform-express`, `body-parser` e `multer`. No frontend: **um pacote crítico (`next`) e dois moderados (`exceljs`/`uuid`, por cadeia transitiva)**. São contagens de pacotes afetados, não necessariamente falhas independentes.

O mantenedor documenta [execução remota em configurações afetadas de Cache Components](https://github.com/vercel/next.js/security/advisories/GHSA-673q-mjm6-r5xr); a auditoria recomenda Next 16.4.3 para o conjunto atual de alertas. Há também [DoS no body-parser](https://github.com/expressjs/body-parser/security/advisories/GHSA-27r3-jxmh-p828). A exploração depende das condições de cada aviso; não foi executado teste de exploração. Atualização de segurança é recomendada antes de implantação; atualizar bibliotecas centrais exige revisão e regressão, preservando a integração WhatsApp. Não foi aplicado `audit fix`, downgrade de ExcelJS ou upgrade major do NestJS.

## GitHub

Git disponível. GitHub CLI 2.103.3 foi obtido da distribuição oficial e teve SHA-256 conferido. O CLI não tinha sessão própria; foi encontrada credencial válida já configurada no Git Credential Manager para `rennefelipe`, usada em memória sem imprimir token. Não é necessário concluir o código de dispositivo solicitado antes dessa descoberta.

O repositório [rennefelipe/whatsgestor](https://github.com/rennefelipe/whatsgestor) foi criado e confirmado **privado** e vazio, sem branches remotos. Nenhum commit foi enviado. A autorização para o primeiro push continua pendente e é distinta de autorização de login.

Após a criação, o responsável respondeu “Deixar GitHub para depois”. As próximas ações remotas foram interrompidas conforme essa preferência. O commit/cópia de revisão permanecem locais; nenhuma autorização de push foi presumida.

## SQL Server e prontidão

Docker está instalado, mas sem daemon ativo; não foi disponibilizado outro SQL Server isolado. Nenhum serviço foi iniciado/reiniciado para obter esse ambiente. Não houve conexão ao banco atual nem execução de DDL nele.

**Criação do banco em SQL Server real ainda não homologada.** A comparação de migrations com metadados e testes de guards/bootstrap com doubles não substituem esse teste. Nenhum banco ou administrador real foi criado. Backend com SQL, autenticação real, permissões e persistência ponta a ponta permanecem pendentes.

Depois de disponibilizar ambiente isolado autorizado, executar o roteiro: banco vazio → três migrations → plano sem pendências → bootstrap bcrypt → login/perfis → cadastros/Excel/persistência. Repetição do bootstrap deve recusar usuários existentes. Pareamento/envio WhatsApp requer autorização separada e não faz parte destes testes.

Esta preparação preserva os arquivos operacionais e a lógica WhatsApp. Não desconecta sessões, realiza envios de teste, modifica flags reais ou reinicia backend/frontend ativos.
