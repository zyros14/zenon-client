// ===== Home Page =====
async function renderHome() {
  const content = document.getElementById('main-content');
  const instances = State.instances;
  const totalMods = await getTotalMods(instances);
  const sel = State.selectedInstance;

  const loaderTag = (loader) =>
    loader === 'fabric'
      ? '<span class="tag tag-fabric">Fabric</span>'
      : loader === 'forge'
        ? '<span class="tag tag-forge">Forge</span>'
        : loader === 'vanilla'
          ? '<span class="tag tag-vanilla">Vanilla</span>'
          : `<span class="tag tag-version">${escapeHtml(loader)}</span>`;

  const sidePanel = sel
    ? `
    <div class="side-instance-card">
      <div class="sic-head">
        <div class="ic-icon">${getInstanceIcon(sel)}</div>
        <div style="min-width:0">
          <div class="sic-name">${escapeHtml(sel.name)}</div>
          <div class="sic-tags">
            <span class="tag tag-version">${escapeHtml(sel.version || '')}</span>
            ${loaderTag(sel.loader)}
          </div>
        </div>
      </div>
      <button class="btn btn-primary sic-play" id="hero-launch-btn-side">
        <svg viewBox="0 0 24 24" fill="currentColor" style="width:16px;height:16px"><polygon points="5 3 19 12 5 21 5 3"/></svg>
        Play now
      </button>
      <button class="btn btn-ghost" id="hero-open-library" style="width:100%;justify-content:center">
        Open library <span class="arrow" aria-hidden="true">&#8599;</span>
      </button>
    </div>`
    : `
    <div class="side-instance-card">
      <div class="sic-empty">
        <strong>No instance selected</strong>
        Create an instance to start playing — it takes about ten seconds.
      </div>
      <button class="btn btn-primary sic-play" id="hero-new-instance-side">
        New instance <span class="arrow" aria-hidden="true">&#8599;</span>
      </button>
    </div>`;

  const emptyState = instances.length === 0
    ? `
    <div class="reveal">
      <div class="section-kicker">Getting started</div>
      <div class="process-list">
        <div class="process-item">
          <span class="process-num">1</span>
          <div>
            <div class="process-title">Create an instance</div>
            <p class="process-desc">Pick a Minecraft version and a loader — Vanilla, Fabric, or Forge. Everything is scoped to its own folder.</p>
          </div>
        </div>
        <div class="process-item">
          <span class="process-num">2</span>
          <div>
            <div class="process-title">Make it yours</div>
            <p class="process-desc">Browse Modrinth for mods, shaders and packs. Required dependencies install themselves.</p>
          </div>
        </div>
        <div class="process-item">
          <span class="process-num">3</span>
          <div>
            <div class="process-title">Press play</div>
            <p class="process-desc">Java, assets and libraries are handled automatically. The launch console shows every step.</p>
          </div>
        </div>
      </div>
    </div>`
    : `
    <div class="recent-section reveal">
      <h2>Recent instances</h2>
      <div class="recent-instances" id="recent-instances-grid">
        ${instances.slice(0, 6).map((inst) => `
          <div class="recent-instance-card" data-id="${inst.id}">
            <div class="ric-icon">${getInstanceIcon(inst)}</div>
            <div class="ric-name">${escapeHtml(inst.name)}</div>
            <div class="ric-meta">
              <span class="tag tag-version">${escapeHtml(inst.version)}</span>
              ${loaderTag(inst.loader)}
            </div>
            <div class="ric-meta" style="margin-top:4px">Played ${formatDate(inst.lastPlayed)}</div>
          </div>
        `).join('')}
      </div>
    </div>`;

  content.innerHTML = `
    <div class="page">
      <header class="home-hero">
        <div class="hero-layout">
          <div class="hero-copy">
            <span class="eyebrow">Modern Minecraft launcher</span>
            <h1>Less setup.<br><span class="gradient-text">More Minecraft.</span></h1>
            <p>Instances, mods, shaders and servers — managed in one clean place and launched in a single click.</p>
            <div class="hero-actions">
              <button class="btn btn-primary btn-lg" id="hero-launch-btn">
                ${sel ? `Play ${escapeHtml(sel.name)}` : 'Pick an instance'} <span class="arrow" aria-hidden="true">&#8599;</span>
              </button>
              <button class="btn btn-ghost btn-lg" id="hero-new-instance-btn">
                New instance <span class="arrow" aria-hidden="true">&#8599;</span>
              </button>
            </div>
            <div class="hero-trust">
              <span class="trust-item"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>Fabric &amp; Forge ready</span>
              <span class="trust-item"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>Modrinth built in</span>
              <span class="trust-item"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>Java handled for you</span>
            </div>
          </div>
          <div class="hero-side">
            ${sidePanel}
          </div>
        </div>
      </header>

      <div class="marquee reveal" aria-hidden="true">
        <div class="marquee-track">
          ${['Custom instances', 'Modrinth mods', 'Shaders & packs', 'Dedicated servers', 'Auto Java runtime', 'Offline mode', 'Live launch console']
            .concat(['Custom instances', 'Modrinth mods', 'Shaders & packs', 'Dedicated servers', 'Auto Java runtime', 'Offline mode', 'Live launch console'])
            .map((t) => `<span class="marquee-item">${t}</span>`).join('')}
        </div>
      </div>

      <div class="stats-row reveal">
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

      ${emptyState}
    </div>
  `;

  // Events
  const launchHandler = () => {
    if (State.selectedInstance) {
      launchInstance(State.selectedInstance.id);
    } else {
      navigateTo('library', { force: true });
      showToast('Select an instance first', 'info');
    }
  };
  document.getElementById('hero-launch-btn')?.addEventListener('click', launchHandler);
  document.getElementById('hero-launch-btn-side')?.addEventListener('click', launchHandler);

  document.getElementById('hero-new-instance-btn')?.addEventListener('click', () => {
    openCreateInstanceModal();
  });
  document.getElementById('hero-new-instance-side')?.addEventListener('click', () => {
    openCreateInstanceModal();
  });

  document.getElementById('hero-open-library')?.addEventListener('click', () => {
    State.libraryPane = 'content';
    navigateTo('library', { force: true });
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
  if (!str) return '';
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(String(str)));
  return div.innerHTML;
}
