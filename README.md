# Zenon Client

A modern Minecraft launcher built with Electron. Clean dark UI with instance management, Modrinth + CurseForge mod browsing, dedicated servers, and a one-click Microsoft sign-in.

---

## Features

### Instances & launching
- **Instance system** — create, duplicate, export, import, repair, and delete Minecraft instances (Vanilla, Fabric, Forge)
- **Game launcher** via `minecraft-launcher-core` with a real-time launch console
- **Auto Java provisioning** — Zenon reads the Java version each Minecraft release requires (26.x → Java 25, 1.20.5+ → Java 21), picks the best Java on your PC, and downloads a matching Eclipse Adoptium runtime into `%APPDATA%\zenon-client\java-runtimes` when nothing compatible exists
- **Animated orb default avatars** — per-instance color orbs when no custom icon is set
- **Recently played** — sidebar shows your last-launched instances and opens them with one click

### Mods
- **Modrinth + CurseForge** — search and install mods, shaders, resource packs, data packs and modpacks (source toggle in Discovery and in the per-instance browser)
- **Auto dependency install** — required dependencies are installed alongside your mod, chain-resolved and deduplicated
- **Mod manager** — enable/disable (`.jar` → `.jar.disabled`) and delete installed mods per instance
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
- Dark **BotForge-inspired design** in Zenon's purple identity: hero home with launch panel, gradient headlines, kicker labels, reveal-on-scroll animations, elevated selects, styled confirmation dialogs
- Grouped sidebar (Menu / Hosting / Recently played) with a compact profile card, **Join Discord** pinned to the bottom
- Toast notifications, splash screen, and a full-keyboard navigation flow

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

Auto-updates work from 1.0.8 → 1.1.1 via `latest.yml` (verified in packaged builds only).

---

## Project structure

```
zenon-client/
├── main.js              # Electron main process (auth, instances, launch, servers, IPC)
├── preload.js           # Secure IPC bridge
├── package.json
├── CHANGELOG.md         # Patch notes
├── README.md
├── build/               # icon.ico for electron-builder
├── scripts/             # Dev tooling (release script + diagnostics)
├── vendor/              # Vendored patched prismarine-auth LiveTokenManager
└── src/
    ├── index.html       # App shell (imports, importmap, CSP)
    ├── assets/          # Logo, animated orb
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
| Electron | Desktop app shell |
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
