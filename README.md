# Zenon Client

A modern Minecraft launcher built with Electron. Clean dark UI inspired by Lunar Client, with instance management, Modrinth mod browser, and offline game launching.

---

## ✅ Features

- **Instance System** — Create, manage, and delete Minecraft instances with Vanilla or Fabric loader support
- **Game Launcher** — Launch Minecraft via `minecraft-launcher-core` with full console output
- **Modrinth Integration** — Search and download mods directly from Modrinth into your instance
- **Auto Dependencies** — Required Modrinth dependencies install automatically alongside your mod (deduplicated, chain-resolved, compatible-version matched)
- **Mod Manager** — View, enable/disable, or delete installed mods per instance
- **Modern Dark UI** — Sidebar navigation, animated transitions, toast notifications

---

## 🚀 Setup & Running

### Prerequisites

- [Node.js](https://nodejs.org/) v18 or later
- Java: recommended (Java 21+), but **not required** — the launcher detects the Java version each Minecraft version needs and auto-downloads a matching runtime (Eclipse Adoptium) when nothing compatible is installed
- npm (comes with Node.js)

### Steps

```bash
# 1. Enter the project directory
cd zenon-client

# 2. Install dependencies
npm install

# 3. Start the launcher
npm start
```

That's it! Zenon Client will open.

---

## 📦 Building a Release

```bash
# Produces dist/Zenon-Client-Setup-<version>.exe (+ .blockmap and latest.yml for auto-update)
npm run dist:win
```

- The app icon is picked up from `build/icon.ico` (generated from `src/assets/zenon-logo.png`).
- Publishing targets the `zyros14/zenon-client` GitHub Releases (see `publish` in `package.json`); auto-updates only work in packaged builds.
- **Tip:** close VS Code (or restart it after `.vscode/settings.json` watcher exclusions load) before packaging — its file watcher can lock freshly written files and fail the build with `EBUSY`.

---

## 📁 Project Structure

```
zenon-client/
├── main.js              # Electron main process
├── preload.js           # Secure IPC bridge
├── package.json
└── src/
    ├── index.html       # App shell
    ├── css/
    │   ├── main.css     # Layout, variables, core styles
    │   └── components.css  # Page-specific component styles
    └── js/
        ├── app.js       # App state, routing, init
        ├── pages/
        │   ├── home.js       # Home page
        │   ├── instances.js  # Instance management + launch
        │   ├── mods.js       # Modrinth search + mod manager
        │   └── settings.js   # Settings page
        └── utils/
            └── helpers.js    # Utility functions
```

---

## 🎮 Usage

### Creating an Instance

1. Go to **Instances** → click **New Instance**
2. Enter a name, select a Minecraft version
3. Choose **Vanilla** or **Fabric** loader
4. If Fabric is selected, pick a Fabric loader version
5. Click **Create Instance**

### Launching

1. Click **Launch** on any instance card
2. The **Console Panel** slides up showing real-time output
3. Wait for Minecraft to download assets and launch (first launch takes longer)

### Installing Mods

1. Select an instance (click it on the Instances page)
2. Go to **Mods**
3. Search for any mod in the left panel
4. Click **Install** → choose a version → **Download**
5. Mod appears in the right panel instantly

### Managing Mods

- **Toggle** the switch to enable/disable a mod (renames `.jar` ↔ `.jar.disabled`)
- Click the **trash icon** to remove a mod

### Settings

- Set your offline **username**, Java path, and RAM allocation
- Click **Save Settings**

---

## ⚠️ Notes

- Modern Minecraft versions need newer Java (e.g. 26.x → Java 25, 1.20.5+ → Java 21). Zenon reads the requirement from Mojang's version metadata, picks the best matching Java already on your PC, and auto-downloads the required runtime into `%APPDATA%\zenon-client\java-runtimes` only if nothing compatible exists.
- First launch of any version will download game files — this may take a few minutes
- Fabric requires that you've selected a Fabric loader version when creating the instance
- The game files are stored per-instance inside Electron's `userData` directory

---

## 🛠 Tech Stack

| Tech | Purpose |
|---|---|
| Electron | Desktop app shell |
| minecraft-launcher-core | Minecraft launching |
| node-fetch | Modrinth & Mojang API calls |
| fs-extra | File system operations |
| uuid | Instance ID generation |
