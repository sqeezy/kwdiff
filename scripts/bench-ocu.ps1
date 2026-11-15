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

# NB: the parameter is [string]$Request, so the parsed object needs its own
# name — assigning to $request would stringify it through the type constraint.
$req = Get-Content -Raw -Path $Request | ConvertFrom-Json

# Either one call ({ tool, args }) or a chain ({ calls: [...] }) that shares one
# ocu process — element indices only stay valid inside that process.
if ($null -ne $req.calls) {
  $payload = $req.calls | ConvertTo-Json -Depth 12 -Compress
  $mode = '--calls'
} elseif ($req.tool) {
  $payload = if ($null -ne $req.args) { $req.args | ConvertTo-Json -Depth 12 -Compress } else { '{}' }
  $mode = $req.tool + ' --args'
} else {
  throw "request file needs 'tool' or 'calls'"
}

# PowerShell 5.1 strips embedded quotes when it calls a native exe, so the
# command line is written to a .bat and handed to cmd, whose escaping rules we
# can actually control.
$escaped = $payload -replace '"', '\"'
$bat = Join-Path $env:TEMP 'ocu-call.bat'
$line = '"' + $ocu + '" call ' + $mode + ' "' + $escaped + '" > "' + $Result + '" 2>&1'
Set-Content -Path $bat -Value $line -Encoding ascii
& cmd.exe /c $bat | Out-Null
