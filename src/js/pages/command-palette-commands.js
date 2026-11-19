// ===== Command Palette: registered commands =====
// Runs after app.js + command-palette.js load. Commands call existing
// window.zenon / app.js functions so nothing new is needed in main process.

(function () {
  const CP = window.CommandPalette;
  if (!CP) return;

  const instLabel = (inst) => String(inst?.name || 'Instance');

  // ----- Instance commands (operate on State.selectedInstance) -----
  CP.register({
    id: 'launch-instance',
    name: 'Launch selected instance',
    description: 'Play the currently selected Minecraft instance',
    category: 'Instance',
    shortcut: 'Play',
    handler: async () => {
      const inst = State.selectedInstance;
      if (!inst) { showToast('No instance selected', 'error'); return false; }
      if (State.runningInstanceIds.has(inst.id)) { showToast(instLabel(inst) + ' is already running', 'info'); return false; }
      await window.zenon.launchGame(inst.id);
      return true;
    }
  });

  CP.register({
    id: 'safe-launch',
    name: 'Safe mode launch',
    description: 'Launch selected instance with all mods disabled (diagnose crashes)',
    category: 'Instance',
    shortcut: 'Safe mode',
    handler: async () => {
      const inst = State.selectedInstance;
      if (!inst) { showToast('No instance selected', 'error'); return false; }
      await window.zenon.launchGameSafe({ instanceId: inst.id });
      return true;
    }
  });

  CP.register({
    id: 'stop-instance',
    name: 'Stop selected instance',
    description: 'Stop the currently running Minecraft instance',
    category: 'Instance',
    shortcut: 'Stop',
    handler: async () => {
      const inst = State.selectedInstance;
      if (!inst) { showToast('No instance selected', 'error'); return false; }
      await window.zenon.stopGameInstance(inst.id);
      return true;
    }
  });

  CP.register({
    id: 'new-instance',
    name: 'New instance',
    description: 'Create a new Minecraft instance',
    category: 'Instance',
    shortcut: 'New',
    handler: async () => {
      openModal('modal-create-instance');
      return true;
    }
  });

  CP.register({
    id: 'edit-instance',
    name: 'Edit selected instance',
    description: 'Open settings for the selected instance',
    category: 'Instance',
    shortcut: 'Edit',
    handler: async () => {
      const inst = State.selectedInstance;
      if (!inst) { showToast('No instance selected', 'error'); return false; }
      navigateTo('instances');
      setTimeout(() => openEditInstanceModal(inst.id), 120);
      return true;
    }
  });

  CP.register({
    id: 'duplicate-instance',
    name: 'Duplicate selected instance',
    description: 'Make a full copy of the selected instance',
    category: 'Instance',
    shortcut: 'Duplicate',
    handler: async () => {
      const inst = State.selectedInstance;
      if (!inst) { showToast('No instance selected', 'error'); return false; }
      try {
        window.zenon.duplicateInstance(inst.id);
        State.instances = await window.zenon.getInstances();
        showToast(`Duplicated "${instLabel(inst)}"`, 'success');
        await renderInstances();
      } catch (e) {
        showToast(`Duplicate failed: ${e?.message || e}`, 'error', 5000);
      }
      return true;
    }
  });

  CP.register({
    id: 'backup-instance',
    name: 'Backup selected instance',
    description: 'Create a zip snapshot of the selected instance',
    category: 'Instance',
    shortcut: 'Backup',
    handler: async () => {
      const inst = State.selectedInstance;
      if (!inst) { showToast('No instance selected', 'error'); return false; }
      try {
        await window.zenon.backupInstance(inst.id);
        showToast(`Backed up "${instLabel(inst)}"`, 'success');
      } catch (e) {
        showToast(`Backup failed: ${e?.message || e}`, 'error', 5000);
      }
      return true;
    }
  });

  CP.register({
    id: 'restore-backup',
    name: 'Restore a backup',
    description: 'Restore an instance backup into a new instance',
    category: 'Instance',
    shortcut: 'Restore',
    handler: async () => {
      // Restore needs a file picker — fall back to opening Tools → Backups
      navigateTo('tools');
      showToast('Open Tools → Backups to restore', 'info');
      return true;
    }
  });

  CP.register({
    id: 'open-instance-folder',
    name: 'Open instance folder',
    description: 'Open the selected instance folder in File Explorer',
    category: 'Instance',
    shortcut: 'Folder',
    handler: async () => {
      const inst = State.selectedInstance;
      if (!inst) { showToast('No instance selected', 'error'); return false; }
      await window.zenon.openInstanceFolder(inst.id);
      return true;
    }
  });

  CP.register({
    id: 'update-all-mods',
    name: 'Update all mods',
    description: 'Update every installed mod in the selected instance',
    category: 'Mods',
    shortcut: 'Update all',
    handler: async () => {
      const inst = State.selectedInstance;
      if (!inst) { showToast('No instance selected', 'error'); return false; }
      const btn = document.getElementById('library-update-all-btn');
      if (btn) { btn.click(); return true; }
      await window.zenon.updateAllMods(inst.id);
      return true;
    }
  });

  CP.register({
    id: 'scan-intelligence',
    name: 'Run Mod Intelligence scan',
    description: 'Scan the selected instance for issues and recommendations',
    category: 'Mods',
    shortcut: 'Intelligence',
    handler: async () => {
      const inst = State.selectedInstance;
      if (!inst) { showToast('No instance selected', 'error'); return false; }
      State.libraryPane = 'content';
      navigateTo('instance', { force: true });
      setTimeout(() => {
        const btn = document.getElementById('library-intel-scan');
        if (btn) btn.click();
      }, 60);
      return true;
    }
  });

  CP.register({
    id: 'browse-mods',
    name: 'Browse & install mods',
    description: 'Open Modrinth/CurseForge browser for the selected instance',
    category: 'Mods',
    shortcut: 'Browse',
    handler: async () => {
      const inst = State.selectedInstance;
      if (!inst) { showToast('No instance selected', 'error'); return false; }
      const btn = document.getElementById('library-open-browse-btn');
      if (btn) { btn.click(); return true; }
      return false;
    }
  });

  CP.register({
    id: 'view-discovery',
    name: 'Open Discovery',
    description: 'Browse mods, modpacks, shaders, and resource packs',
    category: 'Navigation',
    shortcut: 'Discovery',
    handler: async () => {
      navigateTo('discovery');
      return true;
    }
  });

  CP.register({
    id: 'view-home',
    name: 'Open Home',
    description: 'Go to the dashboard',
    category: 'Navigation',
    shortcut: 'Home',
    handler: async () => { navigateTo('home'); return true; }
  });

  CP.register({
    id: 'view-library',
    name: 'Open Library',
    description: 'Go to the instance library',
    category: 'Navigation',
    shortcut: 'Library',
    handler: async () => { navigateTo('library'); return true; }
  });

  CP.register({
    id: 'view-settings',
    name: 'Open Settings',
    description: 'Open launcher settings',
    category: 'System',
    shortcut: 'Settings',
    handler: async () => { navigateTo('settings'); return true; }
  });

  CP.register({
    id: 'toggle-console',
    name: 'Toggle Launch Console',
    description: 'Show or hide the launch console panel',
    category: 'System',
    shortcut: 'Console',
    handler: async () => {
      const panel = document.getElementById('console-panel');
      if (panel) panel.classList.toggle('open');
      return true;
    }
  });

  CP.register({
    id: 'quit-app',
    name: 'Quit Zenon Client',
    description: 'Close the launcher',
    category: 'System',
    shortcut: 'Quit',
    handler: async () => { window.zenon.close(); return true; }
  });

})();
