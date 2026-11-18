# Create the GitHub release for the current version and upload the installer artifacts.
# Token is read from the git credential store and never printed.
#
# Usage (repo root):
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/create-release.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/create-release.ps1 -ArtifactDir C:\path\to\artifacts
#
# Defaults: version from package.json, artifacts from C:\Users\xande\Downloads\zenon-release-<version>.

[CmdletBinding()]
param(
  [string]$Repo = 'zyros14/zenon-client',
  [string]$ArtifactDir = $null,
  [string]$Version = $null
)
$ErrorActionPreference = 'Stop'

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Push-Location $RepoRoot
try {
  if (-not $Version) { $Version = (Get-Content 'package.json' | ConvertFrom-Json).version }
  $Tag = 'v' + $Version
  if (-not $ArtifactDir) { $ArtifactDir = ('C:\Users\xande\Downloads\zenon-release-' + $Version) }

  if (-not (Test-Path $ArtifactDir)) { throw "Artifact folder not found: $ArtifactDir" }

  $exe = Join-Path $ArtifactDir ('Zenon-Client-Setup-' + $Version + '.exe')
  $blockmap = $exe + '.blockmap'
  $latestYml = Join-Path $ArtifactDir 'latest.yml'
  $debugYml = Join-Path $ArtifactDir 'builder-debug.yml'

  foreach ($f in $exe, $blockmap, $latestYml) {
    if (-not (Test-Path $f)) { throw ('Missing required artifact: ' + $f) }
  }

  $credInput = "protocol=https`nhost=github.com`n`n"
  $credOutput = $credInput | git credential fill 2>$null
  $match = $credOutput | Select-String '^password=(.+)$'
  $token = $match.Matches.Groups[1].Value
  if (-not $token) { throw 'No GitHub credential found in git credential store.' }

  # Extract the latest version section from CHANGELOG.md for the release body
  $notes = $null
  if (Test-Path 'CHANGELOG.md') {
    $raw = Get-Content 'CHANGELOG.md' -Raw
    $lines = $raw -split "`r?`n"
    $start = -1
    $end = $lines.Length
    for ($i = 0; $i -lt $lines.Length; $i++) {
      if ($lines[$i] -match '^## \[') {
        if ($start -eq -1) { $start = $i } else { $end = $i; break }
      }
    }
    if ($start -ge 0) {
      $notes = ($lines[$start..($end - 1)] -join "`n").TrimEnd()
    }
  }
  if (-not $notes) {
    Write-Output 'CHANGELOG.md not found or no version section parsed; using a minimal release body.'
    $notes = 'Zenon-Client v' + $Version
  }

  $payload = @{
    tag_name = $Tag
    name = 'Zenon-Client v' + $Version
    body = $notes
    draft = $false
    prerelease = $false
  } | ConvertTo-Json -Depth 4
  $jsonPath = Join-Path $env:TEMP 'zenon-release-payload.json'
  [IO.File]::WriteAllText($jsonPath, $payload)

  Write-Output ('Creating release ' + $Tag + ' ...')
  $respRaw = curl.exe -s -X POST `
    -H ('Authorization: Bearer ' + $token) `
    -H 'Accept: application/vnd.github+json' `
    -H 'Content-Type: application/json' `
    --data-binary ('@' + $jsonPath) `
    ('https://api.github.com/repos/' + $Repo + '/releases')
  Remove-Item $jsonPath -Force -ErrorAction SilentlyContinue

  $resp = $respRaw | ConvertFrom-Json
  if (-not $resp.id) { throw ('Release creation failed: ' + $respRaw) }
  Write-Output ('Release created: ' + $resp.html_url)

  $assets = @($exe, $blockmap, $latestYml)
  if (Test-Path $debugYml) { $assets += $debugYml }

  foreach ($p in $assets) {
    $name = [IO.Path]::GetFileName($p)
    $sizeMb = [math]::Round((Get-Item $p).Length / 1MB, 1)
    Write-Output ('Uploading ' + $name + ' (' + $sizeMb + ' MB)...')
    $encName = [uri]::EscapeDataString($name)
    $upload = 'https://uploads.github.com/repos/' + $Repo + '/releases/' + $resp.id + '/assets?name=' + $encName
    $result = curl.exe -s -X POST `
      -H ('Authorization: Bearer ' + $token) `
      -H 'Content-Type: application/octet-stream' `
      --data-binary ('@' + $p) `
      $upload
    $resultJson = $result | ConvertFrom-Json
    if (-not $resultJson.browser_download_url) {
      Write-Output ('  ! upload response: ' + $result)
    } else {
      Write-Output ('  ok: ' + $resultJson.browser_download_url)
    }
  }

  Write-Output ('Release ' + $Tag + ' done.')
  Remove-Variable token
} finally {
  Pop-Location
}
