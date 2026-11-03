# Foreground launcher for a NEW installation; never stops/restarts other services.
[CmdletBinding()]
param([ValidateSet('backend','frontend')][string]$Component = 'backend')
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'backend/.env.install'))) {
    throw 'Use apenas em instalacao preparada pelo install-windows.ps1.'
}
$port = if ($Component -eq 'backend') { 3001 } else { 3000 }
if (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue) {
    throw "Porta $port ocupada. Nenhum processo foi encerrado."
}
Push-Location (Join-Path $projectRoot $Component)
try {
    if ($Component -eq 'backend') { & node.exe dist/main.js }
    else { & node.exe node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3000 }
    if ($LASTEXITCODE -ne 0) { throw 'Processo terminou com erro.' }
} finally { Pop-Location }
