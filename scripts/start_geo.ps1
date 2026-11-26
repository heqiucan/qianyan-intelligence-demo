param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$url = 'http://127.0.0.1:8010'
$logDir = Join-Path $root 'tmp/geo-launcher'

function Test-GeoReady {
    try {
        $health = Invoke-RestMethod "$url/api/health" -TimeoutSec 2
        $state = Invoke-RestMethod "$url/api/state" -TimeoutSec 2
        $index = Invoke-WebRequest "$url/" -UseBasicParsing -TimeoutSec 2
        $built = Get-Content (Join-Path $root 'frontend/dist/index.html') -Raw -Encoding UTF8
        $assets = [regex]::Matches($built, '/assets/[^"\s]+') | ForEach-Object { $_.Value }
        $sameBuild = $assets.Count -gt 0 -and @($assets | Where-Object { -not $index.Content.Contains($_) }).Count -eq 0
        return $health.service -eq 'zheyan-demo' -and $health.status -eq 'ok' -and $state.model.mode -eq 'replay' -and $sameBuild
    } catch { return $false }
}

try {
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
            if ($probe.ConnectAsync('127.0.0.1', 8010).Wait(500) -and $probe.Connected) {
                throw 'Port 8010 is occupied by a different or unready service. No process was stopped.'
            }
        } catch [System.AggregateException] {
            # Connection refused: this preview service is not running.
        } finally { $probe.Dispose() }
        $env:MODEL_PROVIDER = 'replay'
        $env:MODEL_API_KEY = ''
        $env:DEMO_ACCESS_TOKEN = ''
        $env:KB_SEMANTIC_ENABLED = '0'
        $env:DEMO_DATA_DIR = Join-Path $root 'tmp/fresh-demo/20261125-132317-80e2b2'
        $env:DEMO_FRONTEND_DIR = Join-Path $root 'frontend/dist'
        $env:PYTHONIOENCODING = 'utf-8'
        $stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
        $process = Start-Process -FilePath $python -ArgumentList @('-m','uvicorn','backend.main:app','--host','127.0.0.1','--port','8010') -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logDir "$stamp.stdout.log") -RedirectStandardError (Join-Path $logDir "$stamp.stderr.log") -PassThru
        $deadline = (Get-Date).AddSeconds(35)
        do {
            Start-Sleep -Milliseconds 350
            if (Test-GeoReady) { break }
            if ($process.HasExited) { throw "Preview exited. See $logDir" }
        } while ((Get-Date) -lt $deadline)
        if (-not (Test-GeoReady)) { throw "Preview did not become ready. See $logDir" }
    }
    Write-Output "GEO ready: $url/#/geo (replay mode)"
    if (-not $NoBrowser) { Start-Process "$url/#/geo" }
} catch {
    $message = $_.Exception.Message
    Write-Error $message -ErrorAction Continue
    if (-not $NoBrowser) {
        Add-Type -AssemblyName PresentationFramework
        [System.Windows.MessageBox]::Show($message, 'GEO startup failed') | Out-Null
    }
    exit 1
}
