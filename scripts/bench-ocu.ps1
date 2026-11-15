param(
  [string]$Request = 'C:\Bench\ocu-request.json',
  [string]$Result = 'C:\Bench\ocu-result.txt'
)

# Runs one ocu call in the interactive desktop session.
#
# ocu only sees windows from the console session, and SSH lands elsewhere, so a
# scheduled task with /IT runs this file. The request is a file rather than
# argv because JSON through `schtasks` quoting is a losing game:
#
#   { "tool": "snapshot", "args": { "app": "kwdiff" } }
#
# The result is written as text; read it over SSH.
$ErrorActionPreference = 'Stop'
$ocu = Join-Path $env:USERPROFILE '.pi\mobile\tools\ocu\1.1.2-pp.3\ocu.exe'
if (-not (Test-Path $ocu)) { throw "ocu not found at $ocu" }

$request = Get-Content -Raw -Path $Request | ConvertFrom-Json
$tool = $request.tool
if (-not $tool) { throw "request file has no 'tool'" }

$argsJson = if ($null -ne $request.args) {
  $request.args | ConvertTo-Json -Depth 12 -Compress
} else {
  '{}'
}

$output = & $ocu call $tool --args $argsJson 2>&1 | Out-String
Set-Content -Path $Result -Value $output -Encoding utf8
