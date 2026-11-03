# Instalação em outro computador Windows

Roteiro exclusivo para computador/instância novos e banco vazio `WhatsGestor`. Não executar no ambiente ativo. Não copiar banco, `.env`, sessões, chaves ou mídias da instalação atual para testes.

## Instalador automatizado (preparado em 03/11/2026)

Após instalar os pré-requisitos e clonar o repositório privado no **computador novo**, execute na raiz do clone:

```powershell
powershell.exe -NoProfile -File .\scripts\install-windows.ps1 -PrepareOnly
powershell.exe -NoProfile -File .\scripts\install-windows.ps1
```

O primeiro comando apenas confere ferramentas e recusa uma instalação já configurada. O segundo solicita servidor, instância opcional ou porta TCP fixa, nome do banco, credenciais SQL, login/senha novos do administrador e diretório privado exclusivo. Senhas são lidas sem eco; não informe senhas nos argumentos. Use a política de execução aprovada pela sua infraestrutura caso PowerShell bloqueie scripts locais.

O instalador instala dependências pelos lockfiles, compila o backend, cria o banco quando ausente, confere o histórico, aplica as três migrations, cria o primeiro administrador e executa uma verificação SQL/login usando `AuthService` real sem iniciar Nest ou WhatsApp. Depois gera JWT aleatório, `.env` privados com ACL da conta instaladora/SYSTEM e configura/compila o frontend. Não instala nem reconfigura o serviço SQL Server, IIS, firewall ou serviços Node.

Uma instância nomeada usa SQL Browser para descobrir sua porta TCP. Se SQL Browser estiver indisponível, deixe a instância em branco e informe a porta TCP fixa configurada para ela. O backend recebe host/porta resolvidos e não depende do nome da instância em execução. TCP/IP e autenticação SQL são necessários; autenticação integrada Windows não está implementada pelo backend atual.

O login SQL informado precisa de `CREATE DATABASE` quando o banco não existe e permissões DDL/leitura/escrita no destino para migrations/bootstrap. O mesmo login fica no `.env` gerado. Antes de disponibilizar o sistema, um DBA deve configurar credencial de execução com privilégios mínimos no `.env`, sem alterar a conexão do arquivo de manutenção. Não conceda `sysadmin` apenas para rodar o instalador. Para SQL com certificado autoassinado, a confiança precisa ser explicitamente escolhida; TLS permanece habilitado.

São preservados bancos existentes: schema legado/desconhecido interrompe a instalação, e usuários existentes nunca têm senha, hash ou permissões substituídos. Se já houver um administrador ativo em banco versionado, o provisionamento não cria outro. Sem administrador ativo em uma tabela de usuários não vazia, exige revisão. Há lock/transação no CLI de migrations e bootstrap. Não execute instaladores concorrentes para o mesmo destino.

Ao concluir, abra **dois terminais no computador novo**:

```powershell
powershell.exe -NoProfile -File .\scripts\start-windows.ps1 -Component backend
```

```powershell
powershell.exe -NoProfile -File .\scripts\start-windows.ps1 -Component frontend
```

Acesse `http://localhost:3000/login`. Os launchers executam em primeiro plano, vinculam o frontend a loopback e recusam portas 3000/3001 ocupadas. Eles não encerram processos existentes. A integração WhatsApp permanece desabilitada no novo `.env` até a configuração autorizada do operador.

### Repetição e retomada após falha

O instalador completo recusa `.env`, `.env.local` ou `.env.install` existentes; isso evita sobrescrever a instalação atual ou parcialmente configurada. Não apague esses arquivos para contornar a proteção. Os scripts não apagam o banco caso uma etapa falhe: um banco recém-criado vazio pode permanecer para retomada.

Se a falha ocorrer **antes de gerar `backend/.env`**, corrija a causa e, em um terminal privado no computador novo, retome somente o provisionamento com o arquivo protegido já criado:

```powershell
Set-Location .\backend
# Compile novamente se necessario: npm.cmd ci; npm.cmd run build
# Leia WG_INITIAL_ADMIN_PASSWORD de modo protegido conforme o roteiro SQL abaixo.
node scripts/install-new.cjs provision --config .env.install --database WhatsGestor --username SEU_LOGIN --apply
node scripts/verify-install.cjs --config .env.install --database WhatsGestor --username SEU_LOGIN
Remove-Item Env:WG_INITIAL_ADMIN_PASSWORD -ErrorAction SilentlyContinue
```

Use o nome de banco escolhido, caso diferente de `WhatsGestor`. Reexecutar migrations não repete migrations aplicadas; o provisionamento preserva um administrador existente. A verificação exige a senha do administrador já presente, sem redefini-la. Conclua a geração de `.env` e frontend pelas etapas manuais abaixo. Se a falha ocorrer depois da geração dos ambientes, preserve-os e repita apenas `npm ci`/build da etapa que falhou. Nunca use `--maintenance-approved` no instalador para contornar proteção de banco configurado.

O arquivo `.env.install` contém a credencial de manutenção: mantenha-o protegido, fora de publicação/backup público. As ACLs geradas autorizam a conta instaladora e SYSTEM; caso use outra conta de serviço, conceda explicitamente somente os acessos necessários. O instalador e a verificação real SQL ainda dependem da homologação em uma instância isolada; veja o [relatório de 03/11/2026](PREPARACAO-PUBLICACAO-2026-11-03.md).

## 1. Requisitos e clone privado

Instale Git, Node.js 22 LTS com patch atual, SQL Server e SSMS/sqlcmd. Configure TCP/IP, porta fixa e autenticação SQL. FFmpeg/libopus deve estar no PATH da conta que executará o backend.

```powershell
git clone https://github.com/rennefelipe/whatsgestor.git C:\Apps\WhatsGestor
Set-Location C:\Apps\WhatsGestor
node --version
npm.cmd --version
git --version
```

O clone depende da publicação e de uma conta autorizada no repositório privado. Use Git Credential Manager/navegador ou `gh auth login --web`. Não use senha da conta GitHub nem tokens na URL.

Reserve `C:\ProgramData\WhatsGestor` para arquivos privados. Restrinja ACLs à conta de serviço, SYSTEM e administradores autorizados. Não coloque esse diretório sob o site, no Git ou em compartilhamento público.

## 2. Dependências e backend

```powershell
Set-Location C:\Apps\WhatsGestor\backend
npm.cmd ci
npm.cmd run build
npm.cmd run typecheck
```

Se a rede usa inspeção TLS, configure a CA corporativa confiável para Node; não desabilite verificação TLS. Preserve os lockfiles.

**Ainda não crie `backend/.env`.** Primeiro prepare banco e administrador com arquivo de instalação separado, conforme o [roteiro SQL](CONFIGURACAO-SQL-SERVER.md). Essa ordem evita que a proteção de alvo configurado bloqueie a instalação inicial. Não use `--maintenance-approved` para contornar erro de alvo desconhecido.

## 3. Banco e administrador

Conclua o roteiro SQL: banco novo `WhatsGestor`, `db:plan`, três migrations e bootstrap com senha digitada de modo protegido. Essas operações não acontecem no startup. Banco legado existente precisa de análise própria e não deve receber a baseline.

Só depois:

```powershell
Set-Location C:\Apps\WhatsGestor\backend
Copy-Item .env.example .env
notepad .env
```

Preencha host, porta, login SQL próprio da aplicação, senha, `DB_DATABASE=WhatsGestor` e TLS. Gere JWT aleatório com pelo menos 32 caracteres; exemplo em terminal privado:

```powershell
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
```

Não registre o resultado em tickets ou commits. Para uso local inicial: `HOST=127.0.0.1`, `PORT=3001`, `CORS_ORIGINS=http://localhost:3000,http://127.0.0.1:3000`. Defina diretórios privados exclusivos para estado/mídia e `APP_SETTINGS_DIRECTORY=C:/ProgramData/WhatsGestor/application-settings`. Preserve as opções WhatsApp desabilitadas do exemplo nesta etapa.

## 4. Frontend

```powershell
Set-Location C:\Apps\WhatsGestor\frontend
npm.cmd ci
Copy-Item .env.example .env.local
notepad .env.local
```

Para acesso local, configure `NEXT_PUBLIC_API_URL=/lan-api`. O rewrite existente encaminha essa rota ao backend em `127.0.0.1:3001`. Defina antes do build; nenhuma variável `NEXT_PUBLIC_*` pode conter segredo. Para HTTPS, revise também o [proxy IIS](DEPLOY-IIS.md).

```powershell
npm.cmd run build
npm.cmd run typecheck
npm.cmd test
```

## 5. Início e homologação

Em dois terminais **somente no computador novo**:

```powershell
Set-Location C:\Apps\WhatsGestor\backend
npm.cmd run start:prod
```

```powershell
Set-Location C:\Apps\WhatsGestor\frontend
npm.cmd run start -- --hostname 127.0.0.1
```

Confira `http://127.0.0.1:3001/health/ready`, abra `http://localhost:3000/login` e entre com o administrador criado. Confira perfil, usuário de teste, tipos/organizações/contatos, identificação, prévia/confirmação Excel e persistência após reinício autorizado apenas da nova instalação. HTTP 200 na página de login não comprova autenticação ou persistência SQL.

Antes de disponibilizar em rede, configure HTTPS, firewall, conta de serviço e serviço persistente. Não exponha SQL à internet. Execute somente uma instância por diretório de estado.

## 6. Nova instância WhatsApp

Depende de autorização do operador do número. Use número de homologação e diretórios privados **vazios e exclusivos**; nunca copie `creds.json`, master.key, sessões ou estado de outra instalação. Após homologar banco e login, configure somente o `.env` do computador novo segundo a documentação de integração existente. Habilite integração/pareamento quando autorizado e faça o pareamento por QR na interface. Envio deve permanecer bloqueado até autorização de teste manual.

Não use o número do ambiente ativo para testes. Esta preparação não habilita flags, não faz pareamento/envios e não reinicia os serviços existentes.

## Pendência

Sem SQL Server de teste disponível, banco vazio → migrations → administrador → login permanece pendente. Não promover como instalação homologada sem registrar os resultados reais. Consulte [evidências](PREPARACAO-GITHUB.md).
