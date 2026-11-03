# Execute only in a new clone, on the destination Windows computer.
[CmdletBinding()]
param([switch]$PrepareOnly)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$backendDir = Join-Path $projectRoot 'backend'
$frontendDir = Join-Path $projectRoot 'frontend'
$backendEnv = Join-Path $backendDir '.env'
$frontendEnv = Join-Path $frontendDir '.env.local'
$setupEnv = Join-Path $backendDir '.env.install'

function Invoke-Npm([string]$Directory, [string[]]$Arguments) {
    Push-Location $Directory
    try {
        & npm.cmd @Arguments
        if ($LASTEXITCODE -ne 0) { throw ('npm falhou: ' + ($Arguments -join ' ')) }
    } finally { Pop-Location }
}
function Read-Value([string]$Label, [string]$Default) {
    $value = Read-Host "$Label [$Default]"
    if ([string]::IsNullOrWhiteSpace($value)) { return $Default }
    return $value.Trim()
}
function Read-Private([string]$Label) {
    $secure = Read-Host $Label -AsSecureString
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}
function Env-Line([string]$Key, [string]$Value) {
    if ($Value -match '[\r\n\x00]') { throw 'Valor de ambiente deve ocupar uma linha.' }
    foreach ($quote in @("'", '"', '`')) {
        if (-not $Value.Contains($quote)) { return "$Key=$quote$Value$quote" }
    }
    throw 'Valor contem todos os delimitadores de .env; use outro valor.'
}
function Write-PrivateFile([string]$File, [string]$Contents) {
    # Create with a restrictive ACL before writing any secret. Never overwrite.
    $stream = [IO.File]::Open($File, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    $stream.Close()
    $acl = New-Object Security.AccessControl.FileSecurity
    $acl.SetAccessRuleProtection($true, $false)
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent().User
    foreach ($sid in @($identity, (New-Object Security.Principal.SecurityIdentifier('S-1-5-18')))) {
        $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', 'Allow')))
    }
    Set-Acl -LiteralPath $File -AclObject $acl
    [IO.File]::WriteAllText($File, $Contents, (New-Object Text.UTF8Encoding($false)))
}

# Refuse the active installation BEFORE npm, prompts or SQL connections.
foreach ($file in @($backendEnv, $frontendEnv, $setupEnv)) {
    if (Test-Path -LiteralPath $file) { throw "Instalador exclusivo de clone novo. Arquivo existente preservado: $file. Consulte docs/INSTALACAO-WINDOWS.md para retomar." }
}
Get-Command node.exe, npm.cmd, git.exe -ErrorAction Stop | Out-Null
$nodeMajor = [int]((& node.exe -p 'process.versions.node.split(String.fromCharCode(46))[0]') | Select-Object -Last 1)
if ($nodeMajor -ne 22) { throw 'Use Node.js 22 com patch de seguranca atual para esta versao.' }
if ($PrepareOnly) { Write-Host 'Pre-requisitos basicos OK; nenhum arquivo, banco ou servico alterado.'; exit 0 }

$sqlHost = Read-Value 'Servidor SQL (hostname/IP, sem barra de instancia)' 'localhost'
$instanceName = Read-Host 'Instancia SQL nomeada (vazio para informar porta TCP fixa)'
$sqlPort = Read-Value 'Porta TCP fixa SQL (ignorada quando instancia informada)' '1433'
if ($sqlPort -notmatch '^\d+$' -or [int]$sqlPort -lt 1 -or [int]$sqlPort -gt 65535) { throw 'Porta SQL invalida.' }
$dbName = Read-Value 'Nome do banco NOVO' 'WhatsGestor'
$sqlLogin = Read-Value 'Login SQL com permissao de criar banco e executar migrations' 'whatsgestor_app'
$sqlPassword = Read-Private 'Senha SQL'
$adminLogin = Read-Value 'Login do administrador inicial' 'admin'
$adminPassword = Read-Private 'Senha NOVA do administrador (12 caracteres ou mais; maximo 72 bytes UTF-8)'
if ($adminPassword.Length -lt 12 -or [Text.Encoding]::UTF8.GetByteCount($adminPassword) -gt 72) { throw 'Senha do administrador fora dos limites.' }
if ((Read-Private 'Confirme a senha do administrador') -cne $adminPassword) { throw 'Confirmacao de senha diferente.' }
$trust = Read-Value 'Confiar em certificado SQL autoassinado? true somente para laboratorio' 'false'
if ($trust -notin @('true','false')) { throw 'Informe true ou false.' }
$privateRoot = Read-Value 'Diretorio absoluto EXCLUSIVO de dados privados' (Join-Path $env:ProgramData 'WhatsGestor')
if (-not [IO.Path]::IsPathRooted($privateRoot)) { throw 'Diretorio privado precisa ser absoluto.' }
$privateRoot = [IO.Path]::GetFullPath($privateRoot)
if ($privateRoot.StartsWith($projectRoot.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase) -or $privateRoot -eq $projectRoot) { throw 'Dados privados devem ficar fora do projeto.' }
if (Test-Path -LiteralPath $privateRoot) { throw 'Diretorio privado ja existe; escolha outro exclusivo desta instalacao.' }
$values = [ordered]@{ DB_HOST=$sqlHost; DB_PORT=$sqlPort; DB_DATABASE=$dbName; DB_USERNAME=$sqlLogin; DB_PASSWORD=$sqlPassword; DB_ENCRYPT='true'; DB_TRUST_SERVER_CERTIFICATE=$trust }
if ($instanceName) { $values['WG_SQL_INSTANCE'] = $instanceName }
$lines = foreach ($entry in $values.GetEnumerator()) { Env-Line $entry.Key $entry.Value }
Write-PrivateFile $setupEnv (($lines -join "`n") + "`n")
try {
    Invoke-Npm $backendDir @('ci')
    Invoke-Npm $backendDir @('run','build')
    & node.exe (Join-Path $backendDir 'scripts/install-new.cjs') resolve-instance $setupEnv
    if ($LASTEXITCODE -ne 0) { throw 'Falha ao resolver instancia SQL; nenhum banco foi criado nesta etapa.' }
    # A failure leaves .env.install protected for explicit review/retry, never overwrites it.
    $env:WG_INITIAL_ADMIN_PASSWORD = $adminPassword
    & node.exe (Join-Path $backendDir 'scripts/install-new.cjs') provision --config $setupEnv --database $dbName --username $adminLogin --apply
    if ($LASTEXITCODE -ne 0) { throw 'Falha na criacao/migrations/admin. Veja o codigo acima e o roteiro de retomada.' }
    & node.exe (Join-Path $backendDir 'scripts/verify-install.cjs') --config $setupEnv --database $dbName --username $adminLogin
    if ($LASTEXITCODE -ne 0) { throw 'Banco preparado, mas verificacao SQL/login falhou. Configuracao preservada para revisao.' }
    New-Item -ItemType Directory -Path $privateRoot | Out-Null
    # Directory ACL additionally grants inheritance to new private data files.
    $dirAcl = New-Object Security.AccessControl.DirectorySecurity
    $dirAcl.SetAccessRuleProtection($true, $false)
    foreach ($sid in @([Security.Principal.WindowsIdentity]::GetCurrent().User, (New-Object Security.Principal.SecurityIdentifier('S-1-5-18')))) {
        $dirAcl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')))
    }
    Set-Acl -LiteralPath $privateRoot -AclObject $dirAcl
    $randomBytes = New-Object byte[] 48
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($randomBytes) } finally { $rng.Dispose() }
    $jwt = [Convert]::ToBase64String($randomBytes)
    $config = [IO.File]::ReadAllText($setupEnv) + "`nHOST=127.0.0.1`nPORT=3001`nJWT_EXPIRES_IN=3600`nCORS_ORIGINS=http://localhost:3000,http://127.0.0.1:3000`n"
    $config += (Env-Line 'JWT_SECRET' $jwt) + "`nWHATSAPP_INTEGRATION_ENABLED=false`nWHATSAPP_INTEGRATION_AUTO_RESTORE=true`nWHATSAPP_INTEGRATION_ALLOW_PAIRING=false`nWHATSAPP_INTEGRATION_ALLOW_SEND=false`n"
    foreach ($item in @(@('WHATSAPP_INTEGRATION_STATE_DIR','integration-state'), @('WHATSAPP_SESSIONS_DIR','legacy-sessions'), @('WHATSAPP_MEDIA_DIR','media'), @('APP_SETTINGS_DIRECTORY','application-settings'))) {
        $config += (Env-Line $item[0] (Join-Path $privateRoot $item[1])) + "`n"
    }
    Write-PrivateFile $backendEnv $config
    Write-PrivateFile $frontendEnv "NEXT_PUBLIC_API_URL=/lan-api`n"
    Invoke-Npm $frontendDir @('ci')
    Invoke-Npm $frontendDir @('run','build')
    Invoke-Npm $frontendDir @('run','typecheck')
    Write-Host 'Instalacao preparada. Nenhum processo de aplicacao foi iniciado.'
    Write-Host 'No computador novo: execute scripts/start-windows.ps1 e acesse http://localhost:3000/login.'
    Write-Host 'Ajuste a conta SQL de execucao para privilegios minimos antes de disponibilizar o sistema.'
} finally {
    Remove-Item Env:WG_INITIAL_ADMIN_PASSWORD -ErrorAction SilentlyContinue
    $adminPassword = $null
    $sqlPassword = $null
}
