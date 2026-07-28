param(
  [switch]$SkipDocker,
  [switch]$SkipSeed
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $repositoryRoot

foreach ($command in @('node', 'pnpm', 'docker')) {
  if (-not (Get-Command $command -ErrorAction SilentlyContinue)) {
    throw "$command is required. Install Node.js 24+, pnpm 11.7, and Docker Desktop."
  }
}

$nodeMajor = [int]((node --version).TrimStart('v').Split('.')[0])
if ($nodeMajor -lt 24) {
  throw 'Node.js 24 or newer is required.'
}

if (-not (Test-Path -LiteralPath '.env')) {
  Copy-Item -LiteralPath '.env.example' -Destination '.env'
  Write-Host 'Created .env from .env.example.'
}

pnpm install --frozen-lockfile
if ($LASTEXITCODE -ne 0) { throw 'pnpm install failed.' }

if (-not $SkipDocker) {
  pnpm infra:up
  if ($LASTEXITCODE -ne 0) { throw 'Local infrastructure startup failed.' }
  pnpm db:migrate
  if ($LASTEXITCODE -ne 0) { throw 'Database migration failed.' }
  if (-not $SkipSeed) {
    pnpm db:seed
    if ($LASTEXITCODE -ne 0) { throw 'Database seed failed.' }
  }
}

Write-Host ''
Write-Host 'Development environment is ready.'
Write-Host 'Run: pnpm dev'
