// ===== Home Page =====
async function renderHome() {
  const content = document.getElementById('main-content');
  const instances = State.instances;
  const totalMods = await getTotalMods(instances);

  content.innerHTML = `
    <div class="page">
      <div class="home-hero">
        <h1>ZENON CLIENT</h1>
        <p>Your modern Minecraft launcher. Manage instances, install mods, and launch your game — all in one place.</p>
        <div class="hero-actions">
          <button class="btn btn-primary btn-lg" id="hero-launch-btn">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:18px;height:18px;stroke:white">
              <polygon points="5 3 19 12 5 21 5 3"/>
            </svg>
            ${State.selectedInstance ? `Launch ${State.selectedInstance.name}` : 'Select an Instance'}
          </button>
          <button class="btn btn-ghost btn-lg" id="hero-new-instance-btn">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            New Instance
          </button>
        </div>
      </div>

      <div class="stats-row">
        <div class="stat-card">
          <div class="stat-icon stat-icon-blue">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
          </div>
          <div class="stat-info">
            <h3>${instances.length}</h3>
            <p>Instances</p>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon stat-icon-green">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
          </div>
          <div class="stat-info">
            <h3>${totalMods}</h3>
            <p>Total Mods</p>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon stat-icon-purple">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="7"/><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/></svg>
          </div>
          <div class="stat-info">
            <h3>${State.auth?.profile?.name ? escapeHtml(State.auth.profile.name) : 'Signed out'}</h3>
            <p>Account</p>
          </div>
        </div>
      </div>

      <div class="recent-section">
        <h2>Recent Instances</h2>
        <div class="recent-instances" id="recent-instances-grid">
          ${instances.length === 0
            ? `<div style="grid-column:1/-1"><div class="empty-state">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
                <h3>No instances yet</h3>
                <p>Create your first instance to get started</p>
              </div></div>`
            : instances.slice(0, 6).map(inst => `
              <div class="recent-instance-card" data-id="${inst.id}">
                <div class="ric-icon">${getInstanceIcon(inst)}</div>
                <div class="ric-name">${escapeHtml(inst.name)}</div>
                <div class="ric-meta">
                  <span class="tag tag-version">${inst.version}</span>
                  ${
                    inst.loader === 'fabric'
                      ? '<span class="tag tag-fabric">Fabric</span>'
                      : inst.loader === 'forge'
                        ? '<span class="tag tag-forge">Forge</span>'
                        : inst.loader !== 'vanilla'
                          ? `<span class="tag tag-version">${escapeHtml(inst.loader)}</span>`
                          : ''
                  }
                </div>
                <div class="ric-meta" style="margin-top:4px">Played ${formatDate(inst.lastPlayed)}</div>
              </div>
            `).join('')
          }
        </div>
      </div>
    </div>
  `;

  // Events
  document.getElementById('hero-launch-btn').addEventListener('click', () => {
    if (State.selectedInstance) {
      launchInstance(State.selectedInstance.id);
    } else {
      navigateTo('library', { force: true });
      showToast('Select an instance first', 'info');
    }
  });

  document.getElementById('hero-new-instance-btn').addEventListener('click', () => {
    openCreateInstanceModal();
  });

  document.querySelectorAll('.recent-instance-card').forEach(card => {
    card.addEventListener('click', () => {
      const inst = State.instances.find(i => i.id === card.dataset.id);
      if (inst) {
        State.selectedInstance = inst;
        updateSidebarBadge();
        State.libraryPane = 'content';
        navigateTo('library', { force: true });
      }
    });
  });
}

async function getTotalMods(instances) {
  let total = 0;
  for (const inst of instances) {
    try {
      const mods = await window.zenon.getMods(inst.id);
      total += mods.length;
    } catch (e) {}
  }
  return total;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(str));
  return div.innerHTML;
}
