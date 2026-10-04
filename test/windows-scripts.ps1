#Requires -Version 5.1
$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
$root = Join-Path ([IO.Path]::GetTempPath()) ('weather windows ' + [Guid]::NewGuid())
New-Item -ItemType Directory -Path $root | Out-Null
function Assert($condition, $message) { if (-not $condition) { throw $message } }
function global:Start-Sleep { param($Seconds) }
function global:Test-Docker {
    $global:LASTEXITCODE = 0
    $command = $args -join ' '
    $global:weatherTest_calls.Add($command)
    switch -Wildcard ($command) {
        'info *' { if ($global:weatherTest_scenario -eq 'windows-engine') { 'windows' } else { 'linux' }; return }
        'compose config *' {
            @{services=@{'ws2000-dashboard'=@{image=$(if ($env:WS2000_IMAGE -eq 'ws2000-weather-dashboard:rollback-local') { $env:WS2000_IMAGE } else { 'example/weather:configured' }); volumes=@(
                @{type='bind'; source=(Join-Path $global:weatherTest_project $(if ($global:weatherTest_scenario -eq 'custom-mount') { 'other-data' } else { 'data' })); target='/app/data'},
                @{type='bind'; source=(Join-Path $global:weatherTest_project 'backups'); target='/app/backups'}
            )}}} | ConvertTo-Json -Depth 8 -Compress
            return
        }
        'compose ps *' { 'container-id'; return }
        'inspect --format {{.Image}} *' { 'sha256:old'; return }
        'image inspect --format {{.Id}} *' { if ($global:weatherTest_scenario -eq 'current') { 'sha256:old' } else { 'sha256:new' }; return }
        '*RepoDigests*' { 'example/weather@sha256:verified'; return }
        '*org.opencontainers.image.revision*' { 'revision123'; return }
        'compose pull *' { if ($global:weatherTest_scenario -eq 'pull-failure') { $global:LASTEXITCODE = 1 }; return }
        'compose up *' {
            if ($env:WS2000_IMAGE -eq 'ws2000-weather-dashboard:rollback-local') { $global:weatherTest_rollback = $true }
            if ($global:weatherTest_scenario -eq 'up-failure' -and -not $global:weatherTest_rollback) { $global:LASTEXITCODE = 1 }
            return
        }
        '*State.Health*' {
            if ($global:weatherTest_scenario -eq 'unhealthy' -and -not $global:weatherTest_rollback) { 'unhealthy' } else { 'healthy' }
            return
        }
    }
}
function global:Test-Tar {
    $global:LASTEXITCODE = 0
    if ($global:weatherTest_scenario -eq 'backup-failure') { $global:LASTEXITCODE = 1; return }
    if ($args[0] -eq '-czf') { [IO.File]::WriteAllText($args[1], 'test archive') }
    if ($args[0] -eq '-tzf' -and $global:weatherTest_scenario -eq 'bad-archive') { $global:LASTEXITCODE = 1 }
}
try {
    foreach ($file in @('scripts/setup.ps1','scripts/update.ps1','test/windows-scripts.ps1')) {
        $errors = $null; $tokens = $null
        [Management.Automation.Language.Parser]::ParseFile((Join-Path $repo $file), [ref]$tokens, [ref]$errors) | Out-Null
        Assert ($errors.Count -eq 0) "Syntax errors in $file`: $errors"
    }
    foreach ($global:weatherTest_scenario in @('success','current','pull-failure','backup-failure','bad-archive','unhealthy','up-failure','windows-engine','custom-mount')) {
        $global:weatherTest_project = Join-Path $root $global:weatherTest_scenario
        New-Item -ItemType Directory -Path (Join-Path $global:weatherTest_project 'profiles') -Force | Out-Null
        Copy-Item -LiteralPath (Join-Path $repo 'profiles/pi-performance.env') -Destination (Join-Path $global:weatherTest_project 'profiles')
        & (Join-Path $repo 'scripts/setup.ps1') -ProjectDir $global:weatherTest_project
        $envPath = Join-Path $global:weatherTest_project '.env'
        Assert ([IO.File]::ReadAllText($envPath).Contains('DASHBOARD_PORT=127.0.0.1:3000')) 'New setup must bind to localhost.'
        [IO.File]::AppendAllText($envPath, "`n# preserved")
        & (Join-Path $repo 'scripts/setup.ps1') -ProjectDir $global:weatherTest_project
        Assert ([IO.File]::ReadAllText($envPath).Contains('# preserved')) 'Setup overwrote existing configuration.'
        $metadata = Join-Path $global:weatherTest_project 'data/deployment.json'
        [IO.File]::WriteAllText($metadata, '{"revision":"old"}')
        $global:weatherTest_calls = New-Object 'Collections.Generic.List[string]'
        $global:weatherTest_rollback = $false
        $failed = $false
        $env:WS2000_IMAGE = 'original-environment'
        try {
            & (Join-Path $repo 'scripts/update.ps1') -ProjectDir $global:weatherTest_project -DockerBin Test-Docker -TarBin Test-Tar
        } catch { $failed = $true; Write-Host "Update result: $_" }
        Assert ($env:WS2000_IMAGE -eq 'original-environment') 'Updater leaked its rollback image override.'
        $result = Get-Content -LiteralPath $metadata -Raw | ConvertFrom-Json
        if ($global:weatherTest_scenario -eq 'success') {
            Assert (-not $failed) 'Successful update threw.'
            Assert ($result.image -eq 'example/weather:configured') 'Updater ignored the Compose image.'
            Assert ($result.revision -eq 'revision123') 'Missing deployment revision.'
            Assert ($result.digest -eq 'example/weather@sha256:verified') 'Missing deployment digest.'
        } else {
            Assert ($result.revision -eq 'old') 'Failed/no-op update replaced deployment metadata.'
            Assert ($failed -eq ($global:weatherTest_scenario -ne 'current')) "Incorrect exit status for $global:weatherTest_scenario"
        }
        if ($global:weatherTest_scenario -in @('current','pull-failure','windows-engine','custom-mount')) {
            Assert (-not ($global:weatherTest_calls -match '^compose stop')) 'Preflight/no-op stopped the container.'
        }
        if ($global:weatherTest_scenario -in @('backup-failure','bad-archive')) {
            Assert ([bool]($global:weatherTest_calls -match '^compose start')) 'Backup failure did not restart the old container.'
            Assert (-not ($global:weatherTest_calls -match '^compose up')) 'Started a new image without a verified backup.'
        }
        if ($global:weatherTest_scenario -in @('unhealthy','up-failure')) { Assert $global:weatherTest_rollback 'Failed deployment did not roll back.' }
        # The updater must release its lock after both success and failure.
        $handle = [IO.File]::Open((Join-Path $global:weatherTest_project '.update.lock'), 'OpenOrCreate', 'ReadWrite', 'None')
        $handle.Dispose()
        Write-Host "PASS: $global:weatherTest_scenario"
    }
} finally {
    Remove-Item -LiteralPath $root -Recurse -Force
    Remove-Item Function:\Test-Docker, Function:\Test-Tar, Function:\Start-Sleep
    $env:WS2000_IMAGE = $null
}
