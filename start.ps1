param([int]$Port = 5173)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Install Node.js 22.12+ first.' }
if (-not (Test-Path -LiteralPath 'node_modules')) {
    & npm.cmd ci
    if ($LASTEXITCODE -ne 0) { throw 'npm ci failed.' }
}
if (-not (Test-Path -LiteralPath 'public/dataset/manifest.json')) {
    & "$PSScriptRoot/prepare.ps1"
}
Write-Host "Open http://127.0.0.1:$Port/ in your browser. Press Ctrl+C to stop."
& npm.cmd run dev -- --port $Port --strictPort
