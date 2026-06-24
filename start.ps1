param(
  [int]$Port = 3000
)

$ErrorActionPreference = 'Stop'

if (-not $env:ADMIN_PASSWORD) {
  $securePassword = Read-Host 'Choose an administrator password (at least 10 characters)' -AsSecureString
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
  try {
    $env:ADMIN_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  }
  finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  }
}

if ($env:ADMIN_PASSWORD.Length -lt 10) {
  throw 'The administrator password must contain at least 10 characters.'
}

$env:PORT = $Port
$node = if ($env:CODEX_NODE) { $env:CODEX_NODE } else { 'node' }
& $node (Join-Path $PSScriptRoot 'server.js')
