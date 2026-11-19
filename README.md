# Zenon Client

A modern Minecraft launcher built with Electron. Clean dark UI with instance management, Modrinth + CurseForge mod browsing, dedicated servers, and a one-click Microsoft sign-in.

---

## Features

### Instances & launching
- **Instance system** — create, duplicate, export, import, repair, delete, and **back up** Minecraft instances (Vanilla, Fabric, Forge)
- **Instance backups** — zip snapshots to your app-data `backups/` folder; restore creates a **copy**, never overwrites your live instance
- **Crash history + analysis** — non-zero exits are auto-analyzed (OOM, access violation, mixin/mod crash, duplicate mods, …) and shown with a cause + fix hint on the Logs tab; clear from there
- **Error-aware log viewer** — latest.log with All / Warnings+Errors / Errors-only filters, error+warning counts, one-click copy
- **Game launcher** via `minecraft-launcher-core` with a real-time launch console and a **live progress stepper** (Account → Metadata → Loader → Java → Files → Running)
- **Safe Mode launch** — "Safe mode" next to Play launches with all mods disabled (auto-restored on exit) for mod-crash diagnosis
- **Multi-instance indicators** — every card shows a live "Running" badge with a pulsing dot; sidebar Recents get one too; per-game Stop
- **Activity panel** — centralized task manager (bottom-right) for downloads, Java provisioning, modpack installs, updates and launches, with progress and a persisted recent history
- **Auto Java provisioning** — Zenon reads the Java version each Minecraft release requires (26.x → Java 25, 1.20.5+ → Java 21), picks the best Java on your PC, and downloads a matching Eclipse Adoptium runtime into `%APPDATA%\zenon-client\java-runtimes` when nothing compatible exists
- **Zenon Sigils** — our own inline-SVG avatar set (Core, Orbit, Prism, Nova, Halo, Ember, Comet, Hex): stored as `svg:<id>` per instance, deterministic per-instance default by id hash, shown in the sidebar, library grid, instance detail and Edit modal
- **Recently played** — sidebar shows your last-launched instances and opens them with one click
- **Launch hooks** — pre-launch command and post-exit script, plus a Windows **wrapper** that wraps the game's Java process (`mangohud java …`)
- **World Manager** — Library → instance → Worlds: rename, delete, export to zip, and import world zips into `saves/`, with per-world size, last-modified, and validity info

### Mods
- **Modrinth + CurseForge** — search and install mods, shaders, resource packs, data packs and modpacks (source toggle in Discovery and in the per-instance browser)
- **CurseForge modpack installs** — pick a CF pack, get a new instance: `manifest.json` (game + loader + recommended RAM), every required file resolved per-file through the proxy, `overrides/` deployed into the instance
- **Auto dependency install** — required dependencies are installed alongside your mod, chain-resolved and deduplicated
- **Mod manager** — enable/disable (`.jar` → `.jar.disabled`) and delete installed mods per instance
- **Update all mods** — one click refreshes every installed mod to the latest compatible version (sha1-compared against the file you have; up-to-date mods are skipped; summary toast + Activity task)
- **Export as `.mrpack`** — package an instance as a Modrinth modpack: every local jar sha1 is looked up against Modrinth's version-file endpoint for an exact match; non-Modrinth files ship as overrides (`Edit instance → Share as .mrpack`)
- **Mod Intelligence** — Library → instance → "Mod Intelligence" tab scans installed mods and reports incompatible mods (no compatible version for this MC version + loader), missing required dependencies, duplicates, outdated mods, and crash suspects evidenced in `latest.log`, plus compatible alternative recommendations (`window.zenon.getModIntelligence`)
- **Discovery page** — global browser with version/loader filters and compatible-instance targeting, plus a CurseForge source via Zenon's server-side proxy (no API keys shipped in the client)

### Servers
- **Dedicated servers** from the app: Vanilla, Paper, Fabric, Forge
- **In-app server console**, live player tracking, and Spigot plugin browsing (for Paper servers)
- Servers launch on the **correct Java automatically**

### Skins — Wardrobe
- **3D skin viewer** — see your Minecraft skin rendered in 3D with idle, walk, run, wave and crouch animations
- **Skin library** — save skins locally, rename them, preview them in 3D (spin on hover), or apply them straight to your account
- **Mine / Defaults tabs** — your own skins vs. the official Minecraft defaults, seeded automatically from your local client jar on first run
- **Rename anything** — skins survive the double-save/wipe problem; your most recent skin and earlier backups are kept

### UI
- Dark design in Zenon's purple identity: hero home with launch panel, quiet kicker labels, elevated selects, styled confirmation dialogs
- Grouped sidebar (Menu / Hosting / Recently played) with a compact profile card, **Join Discord** pinned to the bottom
- Toast notifications, splash screen, and a full-keyboard navigation flow
- **Global Command Palette (Ctrl+K)** — fuzzy-search any launcher action: launch, safe mode, stop, new/duplicate/edit/backup instance, update all mods, Mod Intelligence scan, browse mods, Home/Library/Discovery/Settings, toggle console, quit

### Sign-in & updates
- **Microsoft sign-in** (device-code flow) — required to launch Minecraft; profile and skin stay in sync with your account
- **Auto-updates** on packaged builds from GitHub Releases

---

## Setup & running

### Prerequisites
- [Node.js](https://nodejs.org/) v18 or later
- Java 21+ recommended — but **not required**: Zenon auto-downloads the correct runtime per Minecraft version when needed
- A Minecraft: Java Edition account (Microsoft)

### Install and start

```bash
git clone https://github.com/zyros14/zenon-client.git
cd zenon-client
npm install
npm start
```

### Development

```bash
npm test          # unit tests for the pure helpers in main/lib (node --test)
npm run check     # syntax-check the main process entry chain
npm run dev       # start with --dev flag
```

Every push runs the same checks plus an unpacked `electron-builder --dir` smoke build via GitHub Actions (`.github/workflows/ci.yml`).

On first sign-in, use the device code shown in the overlay (https://www.microsoft.com/link) — sign in once and the launcher remembers your session.

---

## Usage

### Create an instance
1. **Instances** → **New Instance**
2. Name it, pick a Minecraft version
3. Choose **Vanilla**, **Fabric**, or **Forge**
4. If Fabric/Forge: pick a loader version
5. Click **Create Instance**

### Launch
Click **Launch** (or **Play** from the home panel). The console panel shows live output; first launch of a version downloads game files (a few minutes).

### Mods
1. Open the instance (click its card or use **Library**)
2. Switch between **Mine / Defaults** tabs in the instance browser
3. **Browse & install** → search Modrinth or CurseForge → click **Install** → choose a version → **Download**
4. Required dependencies install automatically

### Skins
1. **Skins** in the sidebar
2. Save your current skin to the library or browse the **Defaults** tab (Steve, Alex, Sunny, Efe, Zuri, Noor, Ari, Makena, Kai)
3. Rename, remove, or **apply** any card — the 3D viewer confirms it immediately

### Servers
1. **Host a server** → pick type (Vanilla / Paper / Fabric / Forge), name, and version
2. **Create server** — the jar downloads and EULA guidance is written for you
3. **Console & controls** → **Accept EULA & start**, or set `eula=true` manually
4. The console tracks players and lets you run commands (`list`, `say`, `stop`, …)

### Settings
Java path, theme, max/min RAM, MC download sockets, close-on-launch, auto-update checks.

---

## Building a release

```bash
npm run dist:win        # NSIS installer → dist/Zenon-Client-Setup-<version>.exe (+ blockmap + latest.yml)
```

The app icon is picked up automatically from `build/icon.ico`. You need **Windows** (the build target is NSIS). Close VS Code before packaging — its file watcher locks freshly written files and fails the build with `EBUSY`.

Publishing targets `zyros14/zenon-client` GitHub Releases (see `publish` in `package.json`). Electron Builder produces `latest.yml` + blockmap alongside the NSIS installer for auto-updates. To rebuild and publish the release with the included script:

```bash
npm run dist:win                                            # builds the installer into dist/
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/create-release.ps1 -ArtifactDir dist
```

`scripts/create-release.ps1` creates the release from the artifacts in that folder using the git credential store (works without `gh`). It uploads the `.exe`, `.blockmap`, `latest.yml`, and the `release body` taken from the newest section of `CHANGELOG.md`.

Auto-updates work from 1.0.8 → 1.1.3 via `latest.yml` (verified in packaged builds only).

---

## Project structure

```
zenon-client/
├── main.js              # Electron entry — requires ./main/index.js
├── preload.js           # Secure IPC bridge
├── package.json
├── CHANGELOG.md         # Patch notes
├── README.md
├── test/                # Unit tests (node --test) for the pure helpers in main/lib
├── build/               # icon.ico for electron-builder
├── scripts/             # Dev tooling (release script + diagnostics)
├── vendor/              # Vendored patched prismarine-auth LiveTokenManager
├── .github/workflows/   # CI: syntax check + unit tests + electron-builder --dir smoke build
├── main/                # Main process, split by domain
│   ├── index.js         # App lifecycle (createWindow, updater wiring, before-quit)
│   ├── ipc.js           # Every ipcMain.handle/on registration
│   ├── paths.js         # userData layout + one-time dir creation
│   ├── constants.js     # MSA public client ids / device-code endpoints
│   ├── nativeFetch.js   # Global undici fetch with node-fetch fallback
│   ├── bridge.js        # Late-bound mainWindow holder (avoids circular imports)
│   ├── log.js           # sendToRenderer / launch console / auth log + stdout patch
│   ├── settings.js      # settings.json load/save/defaults
│   ├── auth.js          # Microsoft device-code auth (prismarine-auth)
│   ├── instances.js     # Instance CRUD, icons, import/export, scaffolding
│   ├── content.js       # Per-instance/server content folders (mods, shaders, plugins)
│   ├── discovery.js     # Modrinth + CurseForge + Spiget search/install, .mrpack creation
│   ├── cf-modpack.js    # CurseForge modpack installer (manifest.json → required files → overrides)
│   ├── mrpack.js        # .mrpack export (sha1-verified against Modrinth version_file)
│   ├── mods-update.js   # "Update all mods" (sha1 compare, in-place upgrade)
│   ├── crash-history.js # Crash signature analysis + crash-history.json (Logs tab)
│   ├── backups.js       # Instance zip backups + non-destructive restore
│   ├── servers.js       # Dedicated servers: create, runtime, console, player tracking
│   ├── forge.js         # Forge installer + version list helpers
│   ├── mcVersion.js     # Mojang manifest cache, version JSON, Fabric profiles
│   ├── java.js          # Java resolution: overrides → managed runtimes → scan → download
│   ├── launch.js        # Game launch (MCLC options, hooks, running-game state)
│   ├── skins.js         # Skin library + Mojang profile sync + default seeding
│   ├── updater.js       # electron-updater wiring (packaged builds)
│   ├── window.js        # Frameless BrowserWindow
│   ├── serverConfig.js  # server.json reads shared by servers/content
│   └── lib/             # Pure, Electron-free helpers (unit-tested)
│       ├── ram.js       # System RAM detection, parsing, clamping
│       ├── text.js      # Display names, tokens, UUIDs, JWT decode, skin PNG check
│       └── versions.js  # MC version heuristics, Forge sorting, modpack path safety
└── src/
    ├── index.html       # App shell (imports, importmap, CSP)
    ├── assets/          # Logo (zenon-logo.png)
    ├── vendor/          # skinview3d + three (skin viewer)
    ├── css/             # main.css, components.css, skins.css
    └── js/
        ├── app.js       # App state, router, init, modal system
        ├── pages/       # home, instances, library, discovery, host-server, settings, tools, auth, skins
        └── utils/       # helpers.js
```

---

## Notes

- **Microsoft account required** — Zenon does not support offline mode.
- **Minecraft 26.x needs ~3 GB of heap** — the launcher enforces a 3 GB minimum for 26.x builds automatically (your older-version RAM setting is left alone).
- First launch of any version downloads assets (takes a few minutes).
- Windows installer is not code-signed yet — SmartScreen will flag it on first run.
- Game files live per-instance inside Electron's `userData` directory (`%APPDATA%\zenon-client\instances`).

---

## Tech stack

| Tech | Purpose |
|---|---|
| Electron 45 | Desktop app shell |
| minecraft-launcher-core | Game launching |
| prismarine-auth | Microsoft device-code auth |
| skinview3d + three.js | 3D skin viewer |
| node-fetch | Modrinth / CurseForge / Mojang / Paper APIs |
| fs-extra | File system operations |
| uuid | Instance ID generation |
| electron-builder | Packaging |
| electron-updater | Auto-update |

---

## License

MIT
