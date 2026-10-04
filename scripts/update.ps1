#Requires -Version 5.1
[CmdletBinding()]
param(
    [string]$ProjectDir = (Split-Path $PSScriptRoot -Parent),
    [string]$DockerBin = 'docker',
    [string]$TarBin = 'tar',
    [ValidateRange(0, 2147483647)][int]$BackupRetentionDays = 90,
    [ValidateRange(0, 2147483647)][int]$BackupMaxFiles = 12
)
$ErrorActionPreference = 'Stop'
# Native programs report failure via LASTEXITCODE in Windows PowerShell 5.1.
function Invoke-Docker {
    param([string[]]$Arguments)
    $output = & $DockerBin @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Docker command failed: $($Arguments[0]) (exit $LASTEXITCODE)." }
    return $output
}
function Wait-DashboardHealth {
    for ($attempt = 0; $attempt -lt 18; $attempt++) {
        try {
            $status = Invoke-Docker @('inspect', '--format', '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}', 'ws2000-dashboard')
            if ($status -eq 'healthy') { return $true }
        } catch { Write-Verbose $_ }
        Start-Sleep -Seconds 5
    }
    return $false
}
function Remove-ExpiredBackups {
    # Restrict pruning to our archives, never application database snapshots or other files.
    $files = @(Get-ChildItem -LiteralPath $backupRoot -File | Where-Object { $_.Name -match '^weather-data-\d{8}-\d{6}\.tgz$' })
    if ($BackupRetentionDays -gt 0) {
        $cutoff = (Get-Date).AddDays(-$BackupRetentionDays)
        foreach ($file in $files) {
            if ($file.LastWriteTime -lt $cutoff) { Remove-Item -LiteralPath $file.FullName }
        }
    }
    if ($BackupMaxFiles -gt 0) {
        Get-ChildItem -LiteralPath $backupRoot -File |
            Where-Object { $_.Name -match '^weather-data-\d{8}-\d{6}\.tgz$' } |
            Sort-Object Name -Descending | Select-Object -Skip $BackupMaxFiles |
            ForEach-Object { Remove-Item -LiteralPath $_.FullName }
    }
}

$ProjectDir = (Resolve-Path -LiteralPath $ProjectDir).Path
$backupRoot = Join-Path $ProjectDir 'backups'
$oldImageEnvironment = $env:WS2000_IMAGE
$stopped = $false
$recreated = $false
$healthy = $false
$oldImage = $null
$lock = $null
Push-Location -LiteralPath $ProjectDir
try {
    # This handle prevents overlapping scheduled/manual PowerShell updates.
    $lock = [IO.File]::Open((Join-Path $ProjectDir '.update.lock'), 'OpenOrCreate', 'ReadWrite', 'None')
    Get-Command $DockerBin -ErrorAction Stop | Out-Null
    Get-Command $TarBin -ErrorAction Stop | Out-Null
    if ((Invoke-Docker @('info', '--format', '{{.OSType}}')) -ne 'linux') {
        throw 'Start Docker Desktop and switch to Linux containers before updating.'
    }
    # Resolve the actual image from Compose, including .env and WS2000_IMAGE overrides.
    # Do not print this configuration: it also contains private environment values.
    $config = (Invoke-Docker @('compose', 'config', '--format', 'json') | Out-String) | ConvertFrom-Json
    $service = $config.services.'ws2000-dashboard'
    $image = $service.image
    if (-not $image) { throw 'The ws2000-dashboard service has no image configured.' }
    foreach ($target in @('/app/data', '/app/backups')) {
        $mounts = @($service.volumes | Where-Object { $_.target -eq $target })
        $expected = Join-Path $ProjectDir $(if ($target -eq '/app/data') { 'data' } else { 'backups' })
        if ($mounts.Count -ne 1 -or $mounts[0].type -ne 'bind' -or
            [IO.Path]::GetFullPath($mounts[0].source) -ne [IO.Path]::GetFullPath($expected)) {
            throw 'This updater requires the standard ./data and ./backups bind mounts. Back up and update custom mounts separately.'
        }
    }
    if (-not (Test-Path -LiteralPath (Join-Path $ProjectDir 'data') -PathType Container)) {
        throw 'Missing data directory. Run scripts/setup.ps1 before starting the dashboard.'
    }
    if ((Get-Item -LiteralPath (Join-Path $ProjectDir 'data')).Attributes -band [IO.FileAttributes]::ReparsePoint) {
        throw 'The data directory must be a real local folder, not a link or junction.'
    }
    New-Item -ItemType Directory -Force -Path $backupRoot | Out-Null
    $containers = @(Invoke-Docker @('compose', 'ps', '-a', '-q', 'ws2000-dashboard'))
    if ($containers.Count -gt 0) {
        $oldImage = Invoke-Docker @('inspect', '--format', '{{.Image}}', 'ws2000-dashboard')
    }
    Write-Host "Checking $image for an update."
    Invoke-Docker @('compose', 'pull', 'ws2000-dashboard') | Out-Host
    $newImage = Invoke-Docker @('image', 'inspect', '--format', '{{.Id}}', $image)
    if ($oldImage -and $oldImage -eq $newImage) {
        Remove-ExpiredBackups
        Write-Host 'Already current.'
        return
    }
    $digest = Invoke-Docker @('image', 'inspect', '--format', '{{if .RepoDigests}}{{index .RepoDigests 0}}{{else}}{{.Id}}{{end}}', $image)
    $revision = Invoke-Docker @('image', 'inspect', '--format', '{{index .Config.Labels "org.opencontainers.image.revision"}}', $image)
    if ($oldImage) { Invoke-Docker @('image', 'tag', $oldImage, 'ws2000-weather-dashboard:rollback-local') | Out-Host }
    $backupFile = Join-Path $backupRoot ("weather-data-{0}.tgz" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
    if (Test-Path -LiteralPath $backupFile) { throw 'A backup with this timestamp already exists. Retry in a moment.' }
    Invoke-Docker @('compose', 'stop', 'ws2000-dashboard') | Out-Host
    $stopped = $true
    & $TarBin '-czf' $backupFile '-C' $ProjectDir 'data'
    if ($LASTEXITCODE -ne 0) { throw 'Backup failed; the new image will not be started.' }
    & $TarBin '-tzf' $backupFile | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Backup verification failed; the new image will not be started.' }
    $recreated = $true
    Invoke-Docker @('compose', 'up', '-d', '--force-recreate', 'ws2000-dashboard') | Out-Host
    if (-not (Wait-DashboardHealth)) { throw 'Updated container failed its health check.' }
    $healthy = $true
    $metadata = @{
        image = $image; digest = $digest; revision = $revision
        updatedAt = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ssZ')
    } | ConvertTo-Json
    $metadataFile = Join-Path $ProjectDir 'data/deployment.json'
    [IO.File]::WriteAllText("$metadataFile.tmp", $metadata, (New-Object Text.UTF8Encoding $false))
    Move-Item -LiteralPath "$metadataFile.tmp" -Destination $metadataFile -Force
    Remove-ExpiredBackups
    Write-Host 'Update succeeded and passed its health check.'
} catch {
    $failure = $_
    if ($stopped -and -not $healthy) {
        try {
            if (-not $recreated) {
                # Backup failure: restart the unchanged container, never replace it.
                Invoke-Docker @('compose', 'start', 'ws2000-dashboard') | Out-Host
                if ($oldImage -and -not (Wait-DashboardHealth)) { throw 'Prior container did not recover.' }
                Write-Warning 'Update aborted; prior container restarted.'
            } elseif ($oldImage) {
                $env:WS2000_IMAGE = 'ws2000-weather-dashboard:rollback-local'
                $rollbackConfig = (Invoke-Docker @('compose', 'config', '--format', 'json') | Out-String) | ConvertFrom-Json
                if ($rollbackConfig.services.'ws2000-dashboard'.image -ne $env:WS2000_IMAGE) {
                    throw 'Compose does not honor WS2000_IMAGE; automatic rollback cannot select the prior image.'
                }
                Invoke-Docker @('compose', 'up', '-d', '--force-recreate', 'ws2000-dashboard') | Out-Host
                if (-not (Wait-DashboardHealth)) { throw 'Rollback failed its health check.' }
                Write-Warning "Rolled back to the prior image. Backup: $backupFile"
            } else {
                Write-Warning "No prior image is available for rollback. Backup: $backupFile"
            }
        } catch { Write-Warning "Recovery failed: $_. Inspect docker compose logs before retrying." }
    }
    throw $failure
} finally {
    $env:WS2000_IMAGE = $oldImageEnvironment
    if ($lock) { $lock.Dispose() }
    Pop-Location
}
