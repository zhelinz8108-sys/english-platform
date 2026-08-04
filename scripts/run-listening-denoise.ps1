param(
  [string]$CredentialsCsv,
  [string]$Library = 'apps/web/data/listening-library.json',
  [string]$StagingRoot = 'D:\listening-denoise-staging',
  [string]$StateFile = 'D:\listening-denoise-state.json',
  [int]$BatchSize = 12,
  [int]$Bitrate = 128,
  [string[]]$Collections = @(
    'bbc-english-in-a-minute',
    'bbc-6-minute-english',
    'voa-standard-english',
    'scientific-american-60-second',
    'short-wave'
  ),
  [string]$Endpoint = 'https://oss-cn-hangzhou.aliyuncs.com',
  [string]$Region = 'cn-hangzhou',
  [string]$Bucket = 'aurelis-english-assets-386928',
  [string]$Tenant = '019f8d4f-c7ce-77b8-979a-206f28f8fda4'
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = if ($PSScriptRoot) { Split-Path -Parent $PSScriptRoot } else { (Get-Location).Path }
$libraryPath = [System.IO.Path]::GetFullPath((Join-Path $repositoryRoot $Library))
$stagingPath = [System.IO.Path]::GetFullPath($StagingRoot)
$statePath = [System.IO.Path]::GetFullPath($StateFile)
function ConvertFrom-Utf8Base64([string]$Value) {
  return [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($Value))
}

$roots = @{
  'bbc-english-in-a-minute' = ConvertFrom-Utf8Base64 'RDpc55WZ5a2mXOaJmOemj1zlkKzliptcYmJj5LiA5YiG6ZKf6Iux6K+t'
  'bbc-6-minute-english' = ConvertFrom-Utf8Base64 'RDpc55WZ5a2mXOaJmOemj1zlkKzliptc44CQQkJD44CRMDgtMjPlubQrYmJjKzbliIbpkp/oi7Hor63nrYnlpJrkuKrmlofku7Y='
  'voa-standard-english' = ConvertFrom-Utf8Base64 'RDpc55WZ5a2mXOaJmOemj1zlkKzliptcVk9B5bi46YCf6Iux6K+tXOW3suino+WOiw=='
  'scientific-american-60-second' = ConvertFrom-Utf8Base64 'RDpc55WZ5a2mXOaJmOemj1zlkKzliptcNzUw5aWX56eR5a2m576O5Zu95Lq6NjDnp5Jc5bey6Kej5Y6L'
  'short-wave' = ConvertFrom-Utf8Base64 'RDpc55WZ5a2mXOaJmOemj1zlkKzliptcU2hvcnQgV2F2ZQ=='
}

if ($BatchSize -lt 1 -or $BatchSize -gt 50) {
  throw 'BatchSize must be between 1 and 50.'
}
if (-not $CredentialsCsv) {
  $CredentialsCsv = Join-Path $repositoryRoot 'AccessKey_Ali\AccessKey.csv'
}
if (-not (Test-Path -LiteralPath $CredentialsCsv -PathType Leaf)) {
  throw "Credentials CSV is missing: $CredentialsCsv"
}

$credential = Import-Csv -LiteralPath $CredentialsCsv | Select-Object -First 1
$accessKeyId = if ($credential.AccessKeyId) { $credential.AccessKeyId } else { $credential.'AccessKey ID' }
$accessKeySecret = if ($credential.AccessKeySecret) { $credential.AccessKeySecret } else { $credential.'AccessKey Secret' }
if (-not $accessKeyId -or -not $accessKeySecret) {
  throw 'The credential CSV has no AccessKey ID or AccessKey Secret.'
}

New-Item -ItemType Directory -Path $stagingPath -Force | Out-Null
$stateParent = Split-Path -Parent $statePath
if (-not (Test-Path -LiteralPath $stateParent -PathType Container)) {
  New-Item -ItemType Directory -Path $stateParent -Force | Out-Null
}
$resolvedStaging = (Resolve-Path -LiteralPath $stagingPath).Path.TrimEnd('\')

$state = @{}
if (Test-Path -LiteralPath $statePath -PathType Leaf) {
  $loadedState = Get-Content -LiteralPath $statePath -Raw -Encoding UTF8 | ConvertFrom-Json
  foreach ($property in $loadedState.PSObject.Properties) {
    $state[$property.Name] = [int]$property.Value
  }
}

$previous = @{}
foreach ($name in @('S3_ENDPOINT', 'S3_REGION', 'S3_BUCKET', 'S3_ACCESS_KEY', 'S3_SECRET_KEY', 'S3_FORCE_PATH_STYLE')) {
  $previous[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class DenoisePowerState {
  [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
  public static extern uint SetThreadExecutionState(uint esFlags);
}
'@
[DenoisePowerState]::SetThreadExecutionState([uint32]2147483649) | Out-Null

try {
  $env:S3_ENDPOINT = $Endpoint
  $env:S3_REGION = $Region
  $env:S3_BUCKET = $Bucket
  $env:S3_ACCESS_KEY = $accessKeyId
  $env:S3_SECRET_KEY = $accessKeySecret
  $env:S3_FORCE_PATH_STYLE = 'false'

  foreach ($collection in $Collections) {
    if (-not $roots.ContainsKey($collection)) {
      throw "Unknown collection: $collection"
    }
    $sourceRoot = $roots[$collection]
    if (-not (Test-Path -LiteralPath $sourceRoot -PathType Container)) {
      throw "Listening source directory is missing: $sourceRoot"
    }
    $nextSequence = if ($state.ContainsKey($collection)) { [int]$state[$collection] + 1 } else { 1 }

    while ($true) {
      $batchDirectory = Join-Path $stagingPath "$collection\$($nextSequence.ToString('0000'))"
      $manifestPath = Join-Path $batchDirectory 'manifest.json'
      New-Item -ItemType Directory -Path $batchDirectory -Force | Out-Null

      & python (Join-Path $repositoryRoot 'scripts\denoise-listening-batch.py') `
        "--library=$libraryPath" `
        "--collection=$collection" `
        "--source-root=$sourceRoot" `
        "--output=$batchDirectory" `
        "--manifest=$manifestPath" `
        "--start-sequence=$nextSequence" `
        "--limit=$BatchSize" `
        "--bitrate=$Bitrate"
      if ($LASTEXITCODE -ne 0) {
        throw "Denoise batch failed for $collection from sequence $nextSequence."
      }

      $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
      if ($manifest.entries.Count -eq 0) {
        Remove-Item -LiteralPath $batchDirectory -Recurse -Force
        break
      }

      & node (Join-Path $repositoryRoot 'apps\api\scripts\upload-denoised-listening-batch.mjs') `
        "--manifest=$manifestPath" `
        "--tenant=$Tenant" `
        '--concurrency=2'
      if ($LASTEXITCODE -ne 0) {
        throw "Denoised upload failed for $collection from sequence $nextSequence."
      }

      $lastSequence = [int]$manifest.entries[-1].sequence
      $state[$collection] = $lastSequence
      $temporaryState = "$statePath.partial"
      $state | ConvertTo-Json | Set-Content -LiteralPath $temporaryState -Encoding utf8
      Move-Item -LiteralPath $temporaryState -Destination $statePath -Force

      $resolvedBatch = (Resolve-Path -LiteralPath $batchDirectory).Path
      if (-not $resolvedBatch.StartsWith("$resolvedStaging\", [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to remove batch outside staging root: $resolvedBatch"
      }
      Remove-Item -LiteralPath $resolvedBatch -Recurse -Force
      $nextSequence = $lastSequence + 1
    }
  }
  Write-Host "All requested listening collections are denoised. State: $statePath"
} finally {
  [DenoisePowerState]::SetThreadExecutionState([uint32]2147483648) | Out-Null
  foreach ($name in $previous.Keys) {
    [Environment]::SetEnvironmentVariable($name, $previous[$name], 'Process')
  }
  $credential = $null
  $accessKeyId = $null
  $accessKeySecret = $null
}
