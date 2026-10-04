#Requires -Version 5.1
[CmdletBinding()]
param(
    [ValidateSet('pi-zero-2', 'pi-standard', 'pi-performance')]
    [string]$Profile = 'pi-performance',
    [string]$ProjectDir = (Split-Path $PSScriptRoot -Parent)
)
$ErrorActionPreference = 'Stop'
$ProjectDir = (Resolve-Path -LiteralPath $ProjectDir).Path
$envFile = Join-Path $ProjectDir '.env'
if (Test-Path -LiteralPath $envFile) {
    Write-Host '.env already exists; leaving it unchanged.'
} else {
    $content = [IO.File]::ReadAllText((Join-Path $ProjectDir "profiles/$Profile.env"))
    # Start with access from this PC only. LAN access is an explicit configuration choice.
    $content = $content.Replace('DASHBOARD_PORT=3000', 'DASHBOARD_PORT=127.0.0.1:3000')
    [IO.File]::WriteAllText($envFile, $content, (New-Object Text.UTF8Encoding $false))
    Write-Host "Created .env from $Profile."
}
foreach ($name in @('data', 'backups', 'certs', 'secrets')) {
    New-Item -ItemType Directory -Force -Path (Join-Path $ProjectDir $name) | Out-Null
}
Write-Host 'Next: start Docker Desktop in Linux containers mode, edit .env with your Ambient keys, then run docker compose up -d.'
Write-Host 'Open http://localhost:3000. See docs/WINDOWS.md for updates and troubleshooting.'
