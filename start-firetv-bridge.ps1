$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
node (Join-Path $PSScriptRoot 'firetv-bridge.cjs')
