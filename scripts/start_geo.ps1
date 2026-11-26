param([switch]$NoBrowser, [ValidateSet('overview','geo')][string]$Page = 'overview')
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$url = 'http://127.0.0.1:8011'
$logDir = Join-Path $root 'tmp/geo-launcher'
$settingsFile = Join-Path $root 'tmp/workspace-launcher.json'
$activeFile = Join-Path $logDir 'active-data.json'
$dataDirectory = ''

function Test-GeoReady {
    try {
        $health = Invoke-RestMethod "$url/api/health" -TimeoutSec 2
        $state = Invoke-RestMethod "$url/api/state" -TimeoutSec 2
        $index = Invoke-WebRequest "$url/" -UseBasicParsing -TimeoutSec 2
        $built = Get-Content (Join-Path $root 'frontend/dist/index.html') -Raw -Encoding UTF8
        $assets = [regex]::Matches($built, '/assets/[^"\s]+') | ForEach-Object { $_.Value }
        $sameBuild = $assets.Count -gt 0 -and @($assets | Where-Object { -not $index.Content.Contains($_) }).Count -eq 0
        $active = Get-Content -LiteralPath $activeFile -Raw -Encoding UTF8 | ConvertFrom-Json
        return $health.service -eq 'zheyan-demo' -and $health.status -eq 'ok' -and $sameBuild -and $active.dataDirectory -eq $dataDirectory
    } catch { return $false }
}

try {
    if (-not (Test-Path -LiteralPath $settingsFile)) {
        throw 'Original workspace data is not configured. Set tmp/workspace-launcher.json; no empty demo database was created.'
    }
    $settings = Get-Content -LiteralPath $settingsFile -Raw -Encoding UTF8 | ConvertFrom-Json
    $dataDirectory = [IO.Path]::GetFullPath([string]$settings.dataDirectory)
    if (-not (Test-Path -LiteralPath (Join-Path $dataDirectory 'demo.sqlite3'))) {
        throw 'Configured database was not found. Startup stopped without creating replacement data.'
    }
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null
    $python = Join-Path $root '.venv/Scripts/python.exe'
    if (-not (Test-Path -LiteralPath $python)) {
        # This worktree reuses the original checkout's installed dependencies.
        $modules = Get-Item (Join-Path $root 'frontend/node_modules')
        $target = @($modules.Target)[0]
        if ($target) { $python = Join-Path (Split-Path (Split-Path $target -Parent) -Parent) '.venv/Scripts/python.exe' }
    }
    if (-not (Test-Path -LiteralPath $python)) { throw 'Python environment is missing. Restore the project dependencies first.' }
    Push-Location (Join-Path $root 'frontend')
    try {
        & npm.cmd run build *> (Join-Path $logDir 'build.log')
        if ($LASTEXITCODE -ne 0) { throw "Frontend build failed. See $logDir\build.log" }
    } finally { Pop-Location }

    if (-not (Test-GeoReady)) {
        $probe = New-Object System.Net.Sockets.TcpClient
        try {
            if ($probe.ConnectAsync('127.0.0.1', 8011).Wait(500) -and $probe.Connected) {
                throw 'Port 8011 is occupied by a different or unready service. No process was stopped.'
            }
        } catch [System.AggregateException] {
            # Connection refused: this preview service is not running.
        } finally { $probe.Dispose() }
        $env:MODEL_PROVIDER = 'replay'
        $env:MODEL_API_KEY = ''
        $env:DEMO_ACCESS_TOKEN = ''
        $env:KB_SEMANTIC_ENABLED = '0'
        if ($settings.environmentFile -and (Test-Path -LiteralPath $settings.environmentFile)) {
            $allowed = @('MODEL_PROVIDER','MODEL_BASE_URL','MODEL_NAME','MODEL_API_KEY','DEMO_ACCESS_TOKEN','KB_SEMANTIC_ENABLED','KB_EMBEDDING_MODEL_PATH')
            foreach ($line in (Get-Content -LiteralPath $settings.environmentFile -Encoding UTF8)) {
                $parts = $line -split '=', 2
                if ($parts.Count -ne 2 -or $allowed -notcontains $parts[0].Trim()) { continue }
                $value = $parts[1].Trim()
                if ($value.Length -ge 2 -and (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'")))) { $value = $value.Substring(1, $value.Length - 2) }
                [Environment]::SetEnvironmentVariable($parts[0].Trim(), $value, 'Process')
            }
        }
        $env:DEMO_DATA_DIR = $dataDirectory
        $env:DEMO_FRONTEND_DIR = Join-Path $root 'frontend/dist'
        $env:PYTHONIOENCODING = 'utf-8'
        $stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
        $process = Start-Process -FilePath $python -ArgumentList @('-m','uvicorn','backend.main:app','--host','127.0.0.1','--port','8011') -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logDir "$stamp.stdout.log") -RedirectStandardError (Join-Path $logDir "$stamp.stderr.log") -PassThru
        @{ dataDirectory = $dataDirectory; launcherPid = $process.Id } | ConvertTo-Json | Set-Content -LiteralPath $activeFile -Encoding UTF8
        $deadline = (Get-Date).AddSeconds(35)
        do {
            Start-Sleep -Milliseconds 350
            if (Test-GeoReady) { break }
            if ($process.HasExited) { throw "Preview exited. See $logDir" }
        } while ((Get-Date) -lt $deadline)
        if (-not (Test-GeoReady)) { throw "Preview did not become ready. See $logDir" }
    }
    $openUrl = "$url/#/$Page"
    if ($settings.preferredCampaign) { $openUrl += '?campaign=' + [uri]::EscapeDataString([string]$settings.preferredCampaign) }
    Write-Output "Workspace ready: $url/#/$Page (original saved data)"
    if (-not $NoBrowser) { Start-Process $openUrl }
} catch {
    $message = $_.Exception.Message
    Write-Error $message -ErrorAction Continue
    if (-not $NoBrowser) {
        Add-Type -AssemblyName PresentationFramework
        [System.Windows.MessageBox]::Show($message, 'GEO startup failed') | Out-Null
    }
    exit 1
}
