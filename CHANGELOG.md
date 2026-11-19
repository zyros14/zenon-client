# Changelog

All notable changes to **Zenon Client** are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/) and uses [Semantic Versioning](https://semver.org/).

## [1.1.4] - 2026-11-19

### Changed
- **Electron 28 → 45.** Jumps 17 major versions to a supported runtime (Chromium/Node 2+ years newer). No API changes affected the app: the renderer already runs with `contextIsolation` + no Node integration, and the preload only requires `electron`.
- **Main process split into modules.** The 4,100-line `main.js` monolith is now `main/` modules by domain (`auth`, `instances`, `content`, `servers`, `forge`, `mcVersion`, `java`, `launch`, `discovery`, `skins`, `updater`, `window`, `ipc`, `settings`, `log`, `nativeFetch`, `bridge`, `constants`, `serverConfig`, `paths`) with pure helpers in `main/lib/` (`ram`, `text`, `versions`). Root `main.js` is a thin entry. No behavior changes intended — the 73 IPC channels and payloads are byte-identical, verified mechanically.
- **`zenon-client/` nested duplicate removed** from the repo (a stale 1.0.8-era snapshot tracked in git; untracked artifacts on disk deleted). The working tree is now just the app.
- **UI de-vibe pass.** Removed the marketing-garnish layer: the infinite marquee capability strip, "Modern Minecraft launcher" eyebrow, gradient headline text, checkmark trust row, kicker gradient bars, and the artificial 3–10 second *random* splash hold (now hides as soon as the UI is ready, min 400 ms — the splash also lost its Michroma "ZENON is loading" label). Emoji-as-icons in the edit-instance and skins panels replaced with consistent inline SVGs. Same Zenon identity, far less template.
- **Tab switches no longer flash black.** `renderPage` previously wiped `#main-content` on every render, causing a flash of black/empty content between page swaps. Now the outgoing page fades out (100 ms) before the DOM is replaced, and the incoming page fades in (150 ms) — a smooth cross-fade instead of a flash. First render (boot) skips the exit fade since there is no previous page.

### Fixed
- **Forge version dropdown showed builds out of order.** `compareForgeFullIdDesc` parsed `47.3.0` as `47` for every build and fell back to descending string compare, so newer builds didn't sort correctly. Now compares dotted build segments numerically, newest first — as the function name always intended.
- **Mojang snapshot ids like `25w02a` were not detected as snapshots** when the manifest was unavailable (Fabric `-snapshot` flag and type heuristics). The heuristic now recognizes the `YYwnnA` weekly format in addition to `rc`/`pre`/`beta`/`alpha`/`snapshot`.
- **Instance display names lost newlines entirely** instead of converting them to spaces (the newline-collapse ran after control-char stripping, which ate newlines first). Order fixed to match the documented intent.

### Added
- **Unit test suite** (`npm test`, `node --test`) covering the extracted pure helpers — RAM parsing/clamping, text/token/UUID/JWT/skin-PNG helpers, version heuristics and modpack path safety. 29 tests.
- **GitHub Actions CI** (`.github/workflows/ci.yml`): syntax check + unit tests on every push/PR, plus an unpacked `electron-builder --win --dir` smoke build.
- `npm run check` — syntax-checks the main-process entry chain.
- **Safe Mode launch.** A "Safe mode" button next to Play temporarily flips every enabled mod to `.disabled` for a single launch — the fastest way to diagnose a mod crash — and re-enables them automatically when the game exits.
- **Total playtime tracking.** Instance cards and the instance detail header now show *total* time played (accumulated from spawn to exit each session) instead of "last played X ago". Instances with no tracked time show `0m played` (counting up from the first launch on this build).
- **Zenon Sigils — SVG instance avatars.** The default instance avatar is no longer the third-party animated orb (`orb.png`, now removed); it's ours — eight inline-SVG sigils (Core, Orbit, Prism, Nova, Halo, Ember, Comet, Hex), picked deterministically per instance by id hash, selectable in the Edit instance icon picker, with legacy single-letter glyphs still rendering for older instances.
- **Activity task manager.** A centralized, floating Activity panel (bottom-right) shows everything the launcher is doing: downloads, Java runtime provisioning, modpack installs, updates, launches — with progress, outcomes, and a short persisted history.
- **Launch progress stepper.** The launch console now shows a live milestone strip — Account → Metadata → Loader → Java → Files → Running — driven by new `launch-progress` events from the main process, instead of raw console spam alone.
- **Java runtime downloads surface as tasks.** The `[Zenon] Downloading Java N runtime — NN%` console lines now feed the Activity panel.
- **Crash analysis + history.** Non-zero exits are pattern-matched against 8 known failure signatures (OOM, wrong Java, access violation, mixin failure, mod crash, duplicate mods, audio, GL). Records are persisted to `crash-history.json` (capped at 50) and surfaced on the instance **Logs** tab with a headline + fix hint and a Clear button.
- **Instance backups + restore.** Zip snapshots per instance under app-data `backups/<id>/…zip`; restore is **non-destructive** — it extracts into a brand-new instance ("name (restored)"). Create from the instance header (archive icon) or Tools → Backups; restore/delete from the same panel.
- **CurseForge modpack installs** — the "Modpacks" type is no longer disabled on CurseForge (Discovery, instance browser, browse modal). `main/cf-modpack.js` mirrors the .mrpack flow: downloads the pack zip, parses `manifest.json` (game + loader + recommended RAM → sets per-instance `maxRamOverride`), resolves every required `projectID/fileID` through the proxy to `fileName` + `downloadUrl`, downloads 4-way-concurrent into `mods/`, and deploys `overrides/` path-safely. Rolls back (deletes the instance, rethrows) if **zero** required files resolved; otherwise keeps the pack and reports installed/failed counts. IPC `install-cf-modpack`; `window.zenon.installCfModpack`.
  - **Verified end-to-end against the live proxy** with DeceasedCraft Beta (1.20.1 / Forge, 317 required files, 114 MB pack): 306/317 installed in ~99 s, 5,871 override files extracted, manifest parsed cleanly. **11 files the authors locked from third-party API distribution** returned fileName but **no downloadUrl** (metadata-only `fileStatus` guard on CurseForge's side) — every API launcher skips them the same way; the installer reports each by filename as `distribution-locked` and keeps the pack usable.
- **.mrpack export.** `Edit instance → Share as .mrpack` builds a Modrinth modpack: every mod jar's sha1 is looked up on Modrinth's `version_file` endpoint (exact match — url/sha512/size/env); unmatched files ship as overrides; `modrinth.index.json` + `overrides/` written to a user-chosen `.mrpack` path.
- **Update all mods.** One click on the instance Content tab checks every installed Modrinth/CF mod against its latest compatible version; skips up-to-date files by sha1, replaces the rest in place, refreshes meta, and reports via toast + Activity task.
- **Error-aware log viewer.** Logs pane gains All / Warnings+Errors / Errors-only tabs, error+warning counts, and a one-click Copy of the full log; matching lines are highlighted with an accent border.
- **Multi-instance running indicators.** Live "Running" pill on Library cards and Home recent cards, pulsing dot on sidebar Recents; per-game Stop targets the selected instance (most-recent default preserved for existing callers); `get-running-instances` IPC + `stopGameInstance`.
- **Richer notifications.** Java runtime install success toast; non-zero-exit toast pointing at the log; Activity tasks for update download progress/completion/failure.
- **Mod Intelligence pane.** Select an instance → Library → "Mod Intelligence" runs an on-demand scan that flags incompatible mods (no version compatible with the instance's MC version + loader), missing required dependencies (Modrinth), duplicate installs (by project id and jar mod-id), outdated mods (local sha1 vs latest compatible version), and crash suspects (mods named in `latest.log` error/stack lines, evidence-based), plus compatible alternative recommendations you can install straight from the panel. IPC `mod:intelligence`; `window.zenon.getModIntelligence(instanceId)`; pure analysis helpers in `main/mod-intelligence.js` (unit-tested).
- **Global Command Palette (Ctrl+K).** Quick access to any launcher action — launch, safe mode, stop, new/duplicate/edit/backup instance, update all mods, Mod Intelligence scan, browse mods, Home/Library/Discovery/Settings, toggle console, quit. Fuzzy search with keyboard nav (↑/↓/Enter/Esc).
- **World Manager.** Library → instance → Worlds is now a full manager: rename, delete, export to zip, and import world zips into `saves/`, with per-world size, last-modified, and validity info. IPC `world:rename`, `world:delete`, `world:export`, `world:import`, `world:info`.
- **Activity panel auto-hides.** The floating Activity FAB appears when a download, update, launch, or modpack install starts, and automatically hides 30 seconds after the last task finishes. New activity resets the countdown.

### Fixed
- **CurseForge search silently forced "Modpacks" back to "Mods".** A leftover guard in `runDiscoverySearch()` reset the selected type to `mod` whenever the source was CurseForge, so CF modpack searches returned mods. Removed; the CF modpack classId (4471) is now actually exercised.
- **Launch wrapper hook works.** The `Wrapper` instance setting was never applied (it logged nothing and launched plain). On Windows it now generates a shim batch that answers MCLC's `-version` probe truthfully and otherwise execs `<wrapper> "<java>" <game args>` — e.g. `mangohud java -Xmx2G …`. Ignored with a clear message on non-Windows.
- **Update reminder toggle is real.** Settings → Updates previously showed a hard-wired "on" switch with `data-hard-on="true"`; the banner/install reminder is now gated on the persisted `updateReminder` setting (default on), across restart, manual check, and auto-download paths.
- **Auto-updater `latest.yml` format fixed.** The `latest.yml` metadata file on GitHub Releases now matches the 1.1.3 format: base64-encoded SHA512 checksums with top-level `path`/`sha512`/`releaseDate` fields and relative file URLs. Previous 1.1.4 builds used hex-encoded checksums which caused a "sha512 checksum mismatch" error on update check.

### Notes
- Windows installer is not code-signed yet — SmartScreen will flag it on first run ("More info → Run anyway").
- Visual verification of the redesigned Home / Library / icon picker has **not been done from this build** — worth a quick look in the real app.

---

## [1.1.3] - 2026-11-18

### Fixed
- **Tools → Updates could leave the "Install" button permanently disabled** when the update had already auto-downloaded before the page mounted. The banner in `app.js` + the disabled button in `Tools` were out of sync. Now `app.js` flags the download event globally, and `Tools` picks it up on mount — the install button enables itself on next paint.

### Notes
- Windows installer is not code-signed — SmartScreen will flag it on first run ("More info → Run anyway").
- Auto-update from 1.1.2 works: this release ships `latest.yml` and the blockmap.

---

## [1.1.2] - 2026-11-18

### Fixed
- **Background auto-updates could never actually fire.** `onUpdateEvent` forwarded the raw `IpcRendererEvent` object to the renderer instead of the event payload, so every message the updater sent was discarded silently — the "Update ready" banner never showed and progress updates never painted. The preload now unwraps the event properly (`(event, payload) => fn(payload)`), matching what the renderer expects.
- **What this means in practice:** auto-check + auto-download now actually reach the UI. If an update is found you'll see the toast, the banner at the top, and the progress bar in Tools → Updates. If something goes wrong, the status line + toast will say so instead of staying mute.

### Notes
- Windows installer is not code-signed — SmartScreen will flag it on first run ("More info → Run anyway").
- Auto-update from 1.1.1 works: this release ships `latest.yml` and the blockmap.

---

## [1.1.1] - 2026-11-18

### Fixed
- **"Check for updates" no longer silently does nothing.** The button called the IPC correctly, but the renderer never surfaced the result — clicking it showed a brief toast then sat on "Idle" forever, with the Install button permanently disabled and no indication of whether an update was available, applied, or errored. The Tools page now reports the running version and the concrete outcome of every check ("You're up to date (vX).", "Update vY found — downloading…", or the actual error).
- **Current version is now visible** in Tools → Updates (and programmatically available via a new IPC), so you can confirm which build you're on at a glance.
- **Unpackaged builds give a clear message** — running `npm start` now answers "Updates only work in packaged builds." instead of failing silently.

### Notes
- Windows installer is not code-signed — SmartScreen will flag it on first run ("More info → Run anyway").
- Auto-update from 1.1.0 works: this release ships `latest.yml` and the blockmap.

---

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
