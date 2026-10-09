param([switch]$Offline)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
if (-not (Test-Path -LiteralPath '.venv/Scripts/python.exe')) {
    & python -m venv .venv
    if ($LASTEXITCODE -ne 0) { throw 'Python 3.11+ is required.' }
}
& ./.venv/Scripts/python.exe -m pip install -r requirements.txt
if ($LASTEXITCODE -ne 0) { throw 'Python dependency installation failed.' }
$prepareArgs = @('scripts/prepare_data.py')
if ($Offline) { $prepareArgs += '--offline' }
& ./.venv/Scripts/python.exe @prepareArgs
if ($LASTEXITCODE -ne 0) { throw 'Data preparation failed.' }
