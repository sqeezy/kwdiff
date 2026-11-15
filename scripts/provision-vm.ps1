# Provision a kwdiff test bench inside a fresh Windows VM.
# Run once, in an elevated PowerShell, inside the guest:
#   powershell -ExecutionPolicy Bypass -File provision-vm.ps1
# It installs what the bench needs and turns off the things that break builds.
$ErrorActionPreference = 'Stop'
if (-not ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Run this in an elevated PowerShell.'
}

Write-Host '== winget packages'
$packages = @(
  'Git.Git',
  'OpenJS.NodeJS.LTS',
  'Microsoft.EdgeWebView2Runtime',
  'Microsoft.VisualStudio.2022.BuildTools'
)
foreach ($id in $packages) {
  $args = @('install', '--id', $id, '--exact', '--silent', '--accept-package-agreements', '--accept-source-agreements')
  if ($id -eq 'Microsoft.VisualStudio.2022.BuildTools') {
    $args += @('--override', '--quiet --wait --norestart --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended')
  }
  winget @args
}

Write-Host '== rust'
if (-not (Get-Command rustup -ErrorAction SilentlyContinue)) {
  winget install --id Rustlang.Rustup --exact --silent --accept-package-agreements --accept-source-agreements
}
& "$env:USERPROFILE\.cargo\bin\rustup.exe" default stable

Write-Host '== OpenSSH server'
Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0 | Out-Null
Set-Service sshd -StartupType Automatic
Start-Service sshd
New-NetFirewallRule -DisplayName 'OpenSSH Server (sshd)' -Enabled True -Direction Inbound -Protocol TCP -Action Allow -LocalPort 22 -ErrorAction SilentlyContinue | Out-Null

Write-Host '== power: never sleep, no screensaver'
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0
powercfg /change monitor-timeout-ac 0
powercfg /change disk-timeout-ac 0

Write-Host '== git identity for the bench'
git config --global user.name 'kwdiff bench'
git config --global user.email 'bench@localhost'
git config --global init.defaultBranch main

Write-Host ''
Write-Host 'Left for a human, because it needs a password or an opinion:'
Write-Host '  1. Auto-login: Sysinternals Autologon (or netplwiz) for the bench user.'
Write-Host '  2. Windows Update: pause for 2 weeks; never auto-restart.'
Write-Host '  3. Add the app SSH public key to C:\Users\<user>\.ssh\authorized_keys'
Write-Host '  4. Checkpoint the VM: name it "toolchain".'
