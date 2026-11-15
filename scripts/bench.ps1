param(
  [ValidateSet('setup', 'reset', 'dev', 'tauri', 'stop')]
  [string]$Action = 'setup',
  [string]$Path = (Join-Path $env:USERPROFILE 'Bench\kwdiff'),
  [int])

# kwdiff bench: a disposable checkout that never touches a personal clone.
#   setup   clone into X:\Bench\kwdiff and install
#   reset   hard-reset to origin/main + fresh node_modules
#   dev     Vite on port 1421 (browser, fixture data)
#   tauri   the real window, bench identifier and bench port
#   stop    kill the bench dev server and any kwdiff window
$ErrorActionPreference = 'Stop'
$Bench = $Path
$Remote = 'https://github.com/sqeezy/kwdiff.git'

function Stop-Port([int]$Port) {
  $owner = (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue).OwningProcess
  if ($owner) {
    Stop-Process -Id $owner -Force
    Write-Host "stopped pid $owner on $Port"
  }
}

switch ($Action) {
  'setup' {
    if (Test-Path $Bench) { throw "$Bench already exists; use reset" }
    New-Item -ItemType Directory -Force (Split-Path $Bench) | Out-Null
    git clone $Remote $Bench
    Push-Location $Bench
    npm ci
    Pop-Location
    Write-Host "bench ready at $Bench"
  }
  'reset' {
    Push-Location $Bench
    git fetch $Remote main
    git reset --hard FETCH_HEAD
    npm ci
    git log --oneline -1
    Pop-Location
  }
  'dev' {
    Stop-Port $Port
    Start-Process -FilePath npm.cmd `
      -ArgumentList 'run', 'dev', '--', '--port', "$Port" `
      -WorkingDirectory $Bench `
      -RedirectStandardOutput "$Bench\bench-dev.log" `
      -RedirectStandardError "$Bench\bench-dev.err" `
      -WindowStyle Hidden
    Start-Sleep -Seconds 6
    Write-Host "bench dev on http://localhost:$Port (log: $Bench\bench-dev.log)"
  }
  'tauri' {
    Push-Location $Bench
    npm run tauri dev -- --config src-tauri/tauri.bench.conf.json
    Pop-Location
  }
  'stop' {
    Stop-Port $Port
    Get-Process kwdiff -ErrorAction SilentlyContinue | Stop-Process -Force
    Write-Host 'bench stopped'
  }
}
