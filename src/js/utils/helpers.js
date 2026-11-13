// ===== Utility Helpers =====

// Re-export escapeHtml if not already defined globally
if (typeof window.escapeHtml === 'undefined') {
  window.escapeHtml = function(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(String(str)));
    return div.innerHTML;
  };
}

// Debounce
function debounce(fn, delay) {
  let timer;
  return function(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

// Truncate text
function truncate(str, max) {
  if (!str) return '';
  return str.length > max ? str.slice(0, max) + '...' : str;
}

// Copy to clipboard
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    return false;
  }
}

// Format play time
function formatPlayTime(seconds) {
  if (!seconds || seconds < 60) return 'Less than a minute';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

/** Toast text for an install result, including auto-installed Modrinth dependencies. */
function describeDependencyInstall(title, result) {
  const deps = result && result.deps;
  if (!deps || !deps.installed || !deps.installed.length) return `${title} installed`;
  const n = deps.installed.length;
  const names = deps.installed.slice(0, 3).join(', ') + (n > 3 ? ` +${n - 3} more` : '');
  return `${title} installed + ${n} required dependenc${n === 1 ? 'y' : 'ies'}: ${names}`;
}

function showDependencyFailures(result) {
  const deps = result && result.deps;
  if (deps && deps.failed && deps.failed.length) {
    const names = deps.failed.slice(0, 3).join(', ') + (deps.failed.length > 3 ? ` +${deps.failed.length - 3} more` : '');
    showToast(`Required dependencies failed to install: ${names}`, 'error', 6500);
  }
}
