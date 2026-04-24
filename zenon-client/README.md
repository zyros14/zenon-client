# Zenon Client

A modern Minecraft launcher built with Electron. Clean dark UI inspired by Lunar Client, with instance management, Modrinth mod browser, and offline game launching.

---

## ✅ Features

- **Instance System** — Create, manage, and delete Minecraft instances with Vanilla or Fabric loader support
- **Game Launcher** — Launch Minecraft via `minecraft-launcher-core` with full console output
- **Modrinth Integration** — Search and download mods directly from Modrinth into your instance
- **Mod Manager** — View, enable/disable, or delete installed mods per instance
- **Modern Dark UI** — Sidebar navigation, animated transitions, toast notifications

---

## 🚀 Setup & Running

### Prerequisites

- [Node.js](https://nodejs.org/) v18 or later
- [Java](https://adoptium.net/) installed (for launching Minecraft)
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

- This launcher uses **offline mode** (no Microsoft/Mojang authentication)
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
