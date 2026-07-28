param(
  [ValidateSet('upload', 'verify', 'download')]
  [string]$Action = 'verify',

  [string]$CredentialsCsv,

  [string]$Endpoint = 'https://oss-cn-hangzhou.aliyuncs.com',

  [string]$Region = 'cn-hangzhou',

  [string]$Bucket = 'aurelis-english-assets-386928'
)

$ErrorActionPreference = 'Stop'

if (-not $CredentialsCsv) {
  $repositoryRoot = Split-Path -Parent $PSScriptRoot
  $candidate = Get-ChildItem -LiteralPath $repositoryRoot -File |
    Where-Object {
      $_.Extension -eq '.csv' -and
      (Get-Content -LiteralPath $_.FullName -TotalCount 1) -match 'AccessKeyId'
    } |
    Select-Object -First 1
  if (-not $candidate) {
    throw 'Pass -CredentialsCsv with the RAM AccessKey CSV path.'
  }
  $CredentialsCsv = $candidate.FullName
}

$credential = Import-Csv -LiteralPath $CredentialsCsv | Select-Object -First 1
if (-not $credential.AccessKeyId -or -not $credential.AccessKeySecret) {
  throw 'The credential CSV must contain AccessKeyId and AccessKeySecret.'
}

$previous = @{}
foreach ($name in @(
  'S3_ENDPOINT',
  'S3_REGION',
  'S3_BUCKET',
  'S3_ACCESS_KEY',
  'S3_SECRET_KEY',
  'S3_FORCE_PATH_STYLE'
)) {
  $previous[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}

try {
  $env:S3_ENDPOINT = $Endpoint
  $env:S3_REGION = $Region
  $env:S3_BUCKET = $Bucket
  $env:S3_ACCESS_KEY = $credential.AccessKeyId
  $env:S3_SECRET_KEY = $credential.AccessKeySecret
  $env:S3_FORCE_PATH_STYLE = 'false'
  pnpm archive:sync -- $Action
  if ($LASTEXITCODE -ne 0) {
    throw "Archive $Action failed with exit code $LASTEXITCODE."
  }
} finally {
  foreach ($name in $previous.Keys) {
    [Environment]::SetEnvironmentVariable($name, $previous[$name], 'Process')
  }
  $credential = $null
}
