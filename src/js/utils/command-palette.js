// ===== Global Command Palette (Ctrl+K) =====
// Quick access to any launcher action. Self-contained; commands are registered
// here and call existing window.zenon / app.js functions.

const CommandPalette = (() => {
  let container = null;
  let input = null;
  let list = null;
  let visible = false;
  let selectedIdx = -1;
  let commands = [];

  // ---------- Command registry ----------
  // id, name, description, handler (async), category, shortcut
  const register = (cmd) => {
    commands.push(cmd);
  };

  // Commands that work on the currently selected instance.
  const withInst = (label, fn) => async () => {
    const inst = State.selectedInstance;
    if (!inst) { showToast('No instance selected', 'error'); return false; }
    return await fn(inst);
  };

  const run = async (cmd) => {
    try {
      const ok = await cmd.handler();
      if (ok !== false) close();
      return ok;
    } catch (e) {
      showToast(`Command failed: ${e?.message || e}`, 'error', 5000);
      return false;
    }
  };

  const escapeHtml = (s) => String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');

  const fuzzyScore = (query, text) => {
    const q = String(query || '').toLowerCase();
    const t = String(text || '').toLowerCase();
    if (!q) return 0;
    let qi = 0, score = 0, prev = -1;
    for (let i = 0; i < t.length; i++) {
      if (t[i] === q[qi]) {
        score++;
        if (prev === i - 1) score += 2; // consecutive bonus
        if (i === 0 || t[i-1] === ' ' || t[i-1] === '-') score += 3; // word-start bonus
        prev = i;
        qi++;
        if (qi === q.length) break;
      }
    }
    return qi === q.length ? score : -1;
  };

  const filter = (query) => {
    const q = String(query || '').trim();
    return commands
      .map((c) => {
        const score = fuzzyScore(q, c.name) || fuzzyScore(q, c.description) || fuzzyScore(q, c.id);
        return score > 0 ? { ...c, score } : null;
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  };

  const render = (query) => {
    const results = filter(query);
    list.innerHTML = '';
    if (results.length === 0) {
      list.innerHTML = `<div class="cmd-empty">No commands match "${escapeHtml(query)}"</div>`;
      selectedIdx = -1;
      return;
    }
    results.forEach((c, i) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = `cmd-row${i === selectedIdx ? ' cmd-selected' : ''}`;
      row.dataset.index = i;
      row.innerHTML = `
        <div class="cmd-main">
          <div class="cmd-name">${escapeHtml(c.name)}</div>
          <div class="cmd-desc">${escapeHtml(c.description || '')}</div>
        </div>
        <div class="cmd-meta">
          <span class="cmd-cat">${escapeHtml(c.category || '')}</span>
          ${c.shortcut ? `<span class="cmd-shortcut">${escapeHtml(c.shortcut)}</span>` : ''}
        </div>
      `;
      row.addEventListener('click', () => { selectedIdx = i; run(results[i]); });
      list.appendChild(row);
    });
    if (selectedIdx < 0 || selectedIdx >= results.length) selectedIdx = 0;
    updateSelection();
  };

  const updateSelection = () => {
    const rows = list.querySelectorAll('.cmd-row');
    rows.forEach((row, i) => {
      row.classList.toggle('cmd-selected', i === selectedIdx);
      if (i === selectedIdx) row.scrollIntoView({ block: 'nearest' });
    });
  };

  const open = () => {
    if (visible) return;
    visible = true;
    selectedIdx = 0;
    container.classList.add('show');
    document.getElementById('modal-overlay').classList.add('show');
    input.value = '';
    input.focus();
    render('');
    document.addEventListener('keydown', onKey);
  };

  const close = () => {
    if (!visible) return;
    visible = false;
    selectedIdx = -1;
    container.classList.remove('show');
    document.getElementById('modal-overlay').classList.remove('show');
    document.removeEventListener('keydown', onKey);
  };

  const onKey = (e) => {
    if (!visible) return;
    if (e.key === 'Escape') { close(); return; }
    if (e.key === 'Enter') {
      e.preventDefault();
      const results = filter(input.value);
      const cmd = results[selectedIdx];
      if (cmd) run(cmd);
      return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); selectedIdx = Math.min(selectedIdx + 1, list.querySelectorAll('.cmd-row').length - 1); updateSelection(); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); selectedIdx = Math.max(selectedIdx - 1, 0); updateSelection(); return; }
  };

  const init = () => {
    container = document.getElementById('cmd-palette');
    input = document.getElementById('cmd-input');
    list = document.getElementById('cmd-list');
    if (!container || !input || !list) return;

    document.getElementById('cmd-close')?.addEventListener('click', close);
    input.addEventListener('input', (e) => { selectedIdx = 0; render(e.target.value); });
    document.getElementById('cmd-overlay-close')?.addEventListener('click', close);

    // Ctrl+K global shortcut
    document.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        toggle();
      }
    });
  };

  const toggle = () => (visible ? close() : open());

  // Expose
  return { init, register, toggle, open, close, commands };
})();

window.CommandPalette = CommandPalette;
