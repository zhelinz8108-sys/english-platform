param(
  [ValidateSet('upload', 'validate')]
  [string]$Action = 'validate',

  [string]$CredentialsCsv,

  [string]$Library = 'apps/web/data/listening-library.json',

  [string]$Endpoint = 'https://oss-cn-hangzhou.aliyuncs.com',

  [string]$Region = 'cn-hangzhou',

  [string]$Bucket = 'aurelis-english-assets-386928',

  [string]$Tenant = '019f8d4f-c7ce-77b8-979a-206f28f8fda4'
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = if ($PSScriptRoot) { Split-Path -Parent $PSScriptRoot } else { (Get-Location).Path }
$libraryPath = [System.IO.Path]::GetFullPath((Join-Path $repositoryRoot $Library))
$collections = @(
  @{
    Id = 'bbc-english-in-a-minute'
    Root = 'D:\留学\托福\听力\bbc一分钟英语'
  },
  @{
    Id = 'voa-standard-english'
    Root = 'D:\留学\托福\听力\VOA常速英语\已解压'
  },
  @{
    Id = 'scientific-american-60-second'
    Root = 'D:\留学\托福\听力\750套科学美国人60秒\已解压'
  },
  @{
    Id = 'short-wave'
    Root = 'D:\留学\托福\听力\Short Wave'
  }
)

foreach ($collection in $collections) {
  if (-not (Test-Path -LiteralPath $collection.Root -PathType Container)) {
    throw "Listening source directory is missing: $($collection.Root)"
  }
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
  if ($Action -eq 'upload') {
    if (-not $CredentialsCsv) {
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
    $env:S3_ENDPOINT = $Endpoint
    $env:S3_REGION = $Region
    $env:S3_BUCKET = $Bucket
    $env:S3_ACCESS_KEY = $credential.AccessKeyId
    $env:S3_SECRET_KEY = $credential.AccessKeySecret
    $env:S3_FORCE_PATH_STYLE = 'false'
  }

  foreach ($collection in $collections) {
    $arguments = @(
      'apps/api/scripts/import-listening-library.mjs',
      "--library=$libraryPath",
      "--collection=$($collection.Id)",
      "--source-root=$($collection.Root)",
      "--tenant=$Tenant",
      '--concurrency=8'
    )
    if ($Action -eq 'upload') {
      $arguments += '--upload-only=true'
    } else {
      $arguments += '--validate-only=true'
    }
    & node @arguments
    if ($LASTEXITCODE -ne 0) {
      throw "Listening $Action failed for $($collection.Id) with exit code $LASTEXITCODE."
    }
  }
} finally {
  foreach ($name in $previous.Keys) {
    [Environment]::SetEnvironmentVariable($name, $previous[$name], 'Process')
  }
  $credential = $null
}
