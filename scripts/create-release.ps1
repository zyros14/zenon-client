# Create the v1.0.8 GitHub release and upload the installer artifacts.
# Token is read from the git credential store and never printed.
param(
  [string]$ArtifactDir = "C:\Users\xande\Downloads\zenon-release-1.0.8",
  [string]$Repo = "zyros14/zenon-client"
)
$ErrorActionPreference = 'Stop'

$credOutput = "protocol=https`nhost=github.com`n`n" | git credential fill 2>$null
$token = ($credOutput | Select-String '^password=(.+)$').Matches.Groups[1].Value
if (-not $token) { throw "No GitHub credential found in git credential store." }

$notes = @'
Zenon-Client v1.0.8

Highlights
- Minecraft 26.x works out of the box: the launcher reads the Java version each Minecraft release needs and auto-downloads a matching runtime (Eclipse Adoptium) when none is found — fixes the UnsupportedClassVersionError crash on Java 21 machines
- Auto dependency install: installing a mod also installs its required Modrinth dependencies, chain-resolved and deduplicated
- Redesigned BotForge-inspired UI in Zenon's purple identity: hero home with selected-instance launch panel, gradient headlines, reveal animations, animated orb default avatars
- New splash: "ZENON is loading" with animated ring

Fixes & polish
- Launch hang when the Microsoft session expires — now fails fast with a clear sign-in message
- "Auto-check updates" toggle is respected by the updater
- "Close on Launch" setting now works
- Settings "Maximum RAM" dropdown misread MB values
- Removing an instance icon never deleted the file
- Deleting a mod left stale metadata (also broke dependency detection) — now cleaned up
- Spiget plugin download filenames fixed
- Library page no longer crashes when files change on disk
- CSP header hardening; fixed missing electron-updater dependency
- README updated

Windows SmartScreen will flag the installer (no code-signing certificate yet) — choose "More info → Run anyway".
'@

$payload = @{ tag_name = 'v1.0.8'; name = 'Zenon-Client v1.0.8'; body = $notes; draft = $false; prerelease = $false } | ConvertTo-Json -Depth 4
$jsonPath = "$env:TEMP\zenon-release-payload.json"
[IO.File]::WriteAllText($jsonPath, $payload)

Write-Output "Creating release..."
$respRaw = curl.exe -s -X POST -H "Authorization: Bearer $token" -H "Accept: application/vnd.github+json" -H "Content-Type: application/json" --data-binary "@$jsonPath" "https://api.github.com/repos/$Repo/releases"
Remove-Item $jsonPath -Force -ErrorAction SilentlyContinue

$resp = $respRaw | ConvertFrom-Json
if (-not $resp.id) { throw "Release creation failed: $respRaw" }
Write-Output "Release created: $($resp.html_url)"

# Collect assets
$assets = @()
foreach ($f in 'Zenon-Client-Setup-1.0.8.exe', 'Zenon-Client-Setup-1.0.8.exe.blockmap', 'latest.yml', 'builder-debug.yml') {
  $p = Join-Path $ArtifactDir $f
  if (Test-Path $p) { $assets += ,$p }
}
if ($assets.Count -eq 0) { throw "No artifacts found in $ArtifactDir" }

foreach ($p in $assets) {
  $name = [IO.Path]::GetFileName($p)
  Write-Output "Uploading $name ($([math]::Round((Get-Item $p).Length/1MB,1)) MB)..."
  $encName = [uri]::EscapeDataString($name)
  $upload = "https://uploads.github.com/repos/$Repo/releases/$($resp.id)/assets?name=$encName"
  $result = curl.exe -s -X POST -H "Authorization: Bearer $token" -H "Content-Type: application/octet-stream" --data-binary "@$p" $upload
  $resultJson = $result | ConvertFrom-Json
  if (-not $resultJson.browser_download_url) { Write-Output "  ! upload response: $result" } else { Write-Output "  ok: $($resultJson.browser_download_url)" }
}
Write-Output "Release done."
Remove-Variable token
