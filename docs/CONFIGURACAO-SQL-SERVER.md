# SQL Server, migrations e administrador inicial

Procedimento exclusivo de **instalação nova**, com banco vazio `WhatsGestor`. Não executar contra o SQL atual. O backend usa SQL Server/TypeORM e não sincroniza schema automaticamente.

## Servidor e permissões

O DBA configura TCP/IP, porta fixa, autenticação SQL, certificado confiável e acesso limitado. Use `DB_ENCRYPT=true` e `DB_TRUST_SERVER_CERTIFICATE=false`; exceção para certificado autoassinado deve ser explícita e restrita ao laboratório. Não desabilite TLS globalmente.

O login de manutenção precisa de DDL e leitura/escrita para migrations/bootstrap. O login de execução deve ter somente leitura/escrita nas tabelas da aplicação; não deve ser `sysadmin`, criar bancos ou alterar schema. Provisione logins/usuários em procedimento privado do DBA, sem senhas em scripts versionados. Login SQL não é o administrador cadastrado em `users`.

## Criar banco novo

Revise servidor e script. Exemplo em **instância nova**, com autenticação administrativa integrada do DBA:

```powershell
Set-Location C:\Apps\WhatsGestor\backend
sqlcmd -S "localhost,1433" -E -b -i scripts/sql/create-clean-database.sql
```

O script cria exatamente `WhatsGestor` e recusa banco existente. Não cria logins ou copia registros. Se o DBA já criou o banco vazio, não execute o script novamente.

## Arquivo privado de manutenção

Antes de criar `backend/.env`, crie `C:\ProgramData\WhatsGestor\install.env` com os dados fornecidos pelo DBA. Exemplo fictício:

```dotenv
DB_HOST=sql.example.invalid
DB_PORT=1433
DB_USERNAME=whatsgestor_maintenance
DB_PASSWORD=REPLACE_WITH_PRIVATE_MAINTENANCE_PASSWORD
DB_DATABASE=WhatsGestor
DB_ENCRYPT=true
DB_TRUST_SERVER_CERTIFICATE=false
```

O CLI lê exclusivamente esse arquivo, exige banco confirmado, confere `DB_NAME()` e recusa bancos de sistema. Alvo igual ao `.env` existente exige manutenção expressamente autorizada; na instalação nova siga a ordem sem criar `.env` antes deste passo. Em banco legado sem histórico, não aplique baseline nem marque migrations manualmente como executadas.

## Plano e migrations

Após `npm ci` e `npm run build` no backend:

```powershell
npm.cmd run db:plan -- --config C:\ProgramData\WhatsGestor\install.env --database WhatsGestor
npm.cmd run db:migrate -- --config C:\ProgramData\WhatsGestor\install.env --database WhatsGestor --apply
npm.cmd run db:plan -- --config C:\ProgramData\WhatsGestor\install.env --database WhatsGestor
```

Primeiro plano: três migrations pendentes; último: zero. A execução usa transação e lock de manutenção. Não há rollback destrutivo automático; recuperação depende de restauração revisada.

| Migration | Estrutura |
| --- | --- |
| InitialSchema1793016000000 | 12 tabelas: usuários, tipos, organizações, contatos, identificação/preferências e histórico de conexão/conversa/mensagem/mídia. Só semeia cinco campos de identificação. |
| UserProfiles1793275200000 | Nome, email e perfil; validações de administrador/atendente/testador. |
| RecipientSelections1793390400000 | Cinco tabelas de seleção, revisões, itens, origens e operações, com índices, checks e FKs. Não altera tabelas WhatsApp. |

Resultado previsto: 17 tabelas de aplicação e `whatsgestor_migrations`. Geração de SQL e comparação de metadados offline não provam execução no mecanismo SQL Server.

Mensagens automáticas usam JSON privado; prévias Excel usam memória e confirmação nos cadastros existentes; rascunhos de agendamento usam o navegador, sem dispatcher SQL nesta versão.

## Primeiro administrador

Somente depois das três migrations e com `users` vazia. A senha não deve ir em argumento, arquivo ou histórico. Em terminal privado:

```powershell
$adminSecret = Read-Host 'Senha inicial (mínimo 12 caracteres)' -AsSecureString
$adminPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($adminSecret)
try {
    $env:WG_INITIAL_ADMIN_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($adminPointer)
    npm.cmd run db:bootstrap -- --config C:\ProgramData\WhatsGestor\install.env --database WhatsGestor --username administrador --apply
    if ($LASTEXITCODE -ne 0) { throw 'Bootstrap não concluído' }
} finally {
    Remove-Item Env:\WG_INITIAL_ADMIN_PASSWORD -ErrorAction SilentlyContinue
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($adminPointer)
    $adminSecret.Dispose()
}
```

A senha existe brevemente em memória/ambiente do processo. O bootstrap usa bcrypt, aceita no máximo 72 bytes UTF-8 e grava somente hash. Recusa usuários existentes ou migrations pendentes. Cria perfil explícito `administrator`, ativo, com permissões administrativas. Não há senha padrão ou criação no startup. Não usar para redefinir usuários existentes.

Depois configure `backend/.env` com login SQL de execução, não a credencial DDL. Restrinja/recolha a credencial de manutenção conforme política do DBA. Faça login no frontend novo e confira o perfil.

## Homologação pendente

Não foi usado SQL Server isolado nesta preparação. Não foram criados banco ou administrador reais. Antes de promover, registrar migrations em banco vazio, plano sem pendências, hash bcrypt sem senha em claro, login, perfis, cadastros e persistência. Repetir bootstrap deve recusar usuários existentes. Não usar o ambiente operacional como teste.
