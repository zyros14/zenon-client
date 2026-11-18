# Changelog

All notable changes to **Zenon Client** are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/) and uses [Semantic Versioning](https://semver.org/).

## [1.1.0] - 2026-11-18

### Highlights
- **Wardrobe: your skins, in 3D, in one place.** New page to see your Minecraft skin rendered in 3D (Idle, Walk, Run, Wave, Crouch), browse and keep a local skin library, and apply any of them straight from the app — one click, no extra dialogs.
- **All 9 default Minecraft skins** are seeded into your library on first launch (from your local client jar). Manage them alongside your own skins in two tabs: Mine / Defaults.
- **CurseForge in Discovery.** Zenon can now browse and install from CurseForge next to Modrinth — via a server-side Vercel proxy, so no API keys are ever shipped in the client.

### Added
- 3D skin viewer with tailor-made idle/walk/run/crouch animations (crouch holds the pose instead of spamming the crouch toggle).
- Skin library with 3D snapshots (live spin on hover, single shared WebGL context), rename, remove, and one-click apply to your Microsoft account. Skins are persisted locally under the userData skins folder.
- Mine / Defaults tab split in the library; defaults are seeded once from the local vanilla client jar (Steve, Alex, Sunny, Efe, Zuri, Noor, Ari, Makena, Kai).
- CurseForge source toggle in Discovery and in the instance Mods/Shaders/Resource Packs/Data Packs browser. Modpack installs are Modrinth-only until CF modpack support lands.
- Sidebar reorganized into labeled sections (Menu / Hosting / Recently played) with a compact profile card at the bottom; Recently played shows your last-launched instances and opens them directly.
- "Join Discord" button pinned to the bottom of the sidebar.
- Library page now shows all your instances in one grid; the dedicated instance page (opened from Recents, or any instance card) shows content/files/worlds/logs and richer mod cards (size, Active/Disabled state).
- Instance summary strip on the instance page (version, loader, counts, size, on/off chips) next to Install/Browse controls.

### Fixed
- Mojang profile fetch no longer 429s on every Refresh — the profile is cached (90 s), all GETs retry with backoff, and the post-apply profile is re-fetched fresh.
- Skin library no longer exhausts the browser's WebGL context ceiling on large libraries (frozen snapshots + a single live hover viewer).
- The whole-card "click to apply skin" action is now properly separated from rename/remove and no longer triggers on those controls.
- Manual update check from 1.0.10 remains fixed.

### Changed
- Library layout split: Library = all-instances grid; instance detail page is now reachable from Recents or any instance card.
- Sidebar grouping and bottom section simplified (compact profile card with Settings + Discord, hosting moved under Recents).

### Notes
- Windows installer is not code-signed — SmartScreen will flag it on first run ("More info → Run anyway").
- Auto-update from 1.0.10 works: this release ships `latest.yml` and the blockmap.
- CurseForge content is served through Zenon's Vercel proxy; the proxy code itself never ships inside the client.

---

## [1.0.10] - 2026-11-18

### Fixed
- **Manual "Check for updates" now works.** `update:check` no longer returns electron-updater's raw `checkForUpdates()` result over IPC — its `cancellationToken` and `downloadPromise` (class instances / promises) can't be structured-cloned, so the button silently threw "An object could not be cloned" whenever an update was actually available. It now returns a plain `{ isUpdateAvailable, versionInfo }` object.
- **Java 25 auto-provisioning** is unchanged, but the 1.0.8 test build on 1.0.8 packaged with the fix was verified end-to-end: it detected this release as an available update from the live GitHub feed.

### Notes
- Auto-update from 1.0.9 → 1.0.10 works out of the box: the 1.0.9 build reaches GitHub, fetches `latest.yml`, and offers the update.
- Windows installer is not yet code-signed — SmartScreen will flag it ("More info → Run anyway").

---

## [1.0.9] - 2026-11-18

### Highlights
- **Minecraft 26.x boots out of the box.** The launcher now enforces a **3 GB minimum heap** for Java-25+/26.x versions, fixing the consistent `0xC0000005` (access violation) crash on Vanilla 26.x at startup. Your existing `settings.json` RAM choice is preserved for older versions.
- **Dedicated servers now launch on the correct Java.** Starting a Vanilla/Paper/Fabric/Forge server auto-resolves (and auto-downloads, if needed) the Java version its Minecraft release requires — previously servers launched on PATH Java and crashed instantly on 26.x.
- **Paper support moved to the new Fill v3 API.** PaperMC sunset the old v2 API (every request returned `410 sunset`), which broke the Paper version list and all Paper server creation. The dropdown now shows the latest stable builds first and pulls the newest stable jar per version.

### Added
- **Automatic required-dependency installation** — installing a mod from Modrinth also installs its required dependencies, chain-resolved and deduplicated against what's already on disk.
- **Microsoft sign-in only** — the offline-mode toggle was removed. Zenon now requires a Microsoft account for all launches (the offline path produced unusable profiles and broke server auth).
- **Styled confirmation dialogs** — destructive actions (delete instance, remove mod, delete server, reset settings, logout, EULA acceptance) now use an in-app Zenon-styled dialog instead of native OS popups.
- **Animated orb avatars** — new instances get the animated nebula orb as their default profile picture, in a stable per-instance color.
- **BotForge-inspired UI refresh** — hero home with selected-instance launch panel, kicker labels, gradient headlines, reveal-on-scroll animations, marquee capability strip, elevated `.form-select` styling, numbered getting-started steps in the empty state.

### Fixed
- **Game launch hang on expired Microsoft sessions** — silent refresh now fails fast after 90 s with a clear "please sign in again" error instead of hanging forever in `Launching…`.
- **Create Instance button stuck** — it no longer stays permanently disabled after the first instance is created.
- **Deleting an instance** no longer teleports you to the Library page; it refreshes the page you're on in place.
- **"Auto-check updates" toggle** is now actually respected by the updater.
- **"Close on Launch" toggle** now closes the launcher when the game starts.
- **Settings "Maximum RAM" dropdown** misread MB-valued entries (e.g. `512M` became 524288 MB).
- **Removing an instance icon** never deleted the file (bad regex); deleting a mod left stale metadata behind (also fixed dependency detection).
- **Spiget plugin downloads** kept ugly numeric filenames (RFC-5987 `filename*=` parsing fixed).
- **Library page crash** when files vanish from disk between scan and stat during game runs.
- **Instance creation** — the loader dropdown sub-menus no longer linger open after switching back to Vanilla.
- **Forge server installers** run on the resolved Java instead of PATH Java.

### Changed
- **Default instance avatar** is now the animated nebula orb when no custom icon is set (letter icons still apply for the built-in glyph picker).
- **About screen** updated to 1.0.9.
- **README** completely rewritten to match the current app (Microsoft sign-in, auto Java download, servers, structure, building a release).

### Notes
- **Windows installer is not yet code-signed** — Windows SmartScreen will flag it on first run ("More info → Run anyway"). We'll sign the installer once we have a certificate.
- **Auto-update** from 1.0.8 works: the release includes `latest.yml` and the blockmap, so packaged 1.0.8 clients will offer the 1.0.9 update.

---

## [1.0.8] - 2026-11-13

### Added
- **Java 25 auto-provisioning** — the launcher reads each Minecraft version's `javaVersion` requirement from Mojang's version metadata, picks the best Java on your PC, and auto-downloads a matching Adoptium runtime when nothing compatible exists. Minecraft 26.x runs on Java 21 machines out of the box.
- **Automatic required-dependency installation** — Modrinth mods install their required dependencies automatically (chain-resolved, deduplicated).
- **Dedicated servers** — Vanilla, Paper, Fabric, and Forge servers can be created from the app, with in-app console, live player tracking, and Spigot plugin browsing.
- **Instance Library** — per-instance content manager (Mods / Shaders / Resource Packs / Data Packs / Modpacks), file browser, world list, and log viewer.
- **Discovery page** — global Modrinth browser with type pills, version and loader filters, and compatible-instance install targeting.
- **Instance import/export (zip)**, instance icons, duplicate/repair, search/filter everywhere.
- **Auto-updates** from GitHub Releases (packaged builds only).

### Changed
- Full **BotForge-inspired UI redesign** in Zenon's purple identity: Space Grotesk typography, kicker labels, hero home with launch panel, gradient headlines, reveal-on-scroll animations, marquee strip, elevated selects.
- Splash screen simplified to logo + ring spinner.

### Fixed
- Launch crash on 26.x due to PATH Java 21 (`UnsupportedClassVersionError`) — root-caused to Java-version mismatch and fixed via auto-provisioning.
- "Close on Launch" toggle was saved but never applied; now works.
- Microsoft sign-in stall when the cached token expired mid-flow — now fails with a clear sign-in prompt.
- Deleting an instance no longer navigates away from the manage page.
- Memory dropdown misparsing MB-based RAM selections.
- Instance icon removal regex; stale content metadata on mod deletion.
- Spiget plugin downloads; Library page crash on disk changes.

---

[1.0.10]: https://github.com/zyros14/zenon-client/releases/tag/v1.0.10
[1.0.9]: https://github.com/zyros14/zenon-client/releases/tag/v1.0.9
[1.0.8]: https://github.com/zyros14/zenon-client/releases/tag/v1.0.8
