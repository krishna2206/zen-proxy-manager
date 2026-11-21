'use strict';

let _currentState = null;
let _profiles = [];
let _groups = [];
let _searchFilter = '';
let _hasHostPermission = true;

function countryCodeToFlag(code) {
  if (!code || code.length !== 2) return '';
  const base = 127462 - 65;
  return String.fromCodePoint(...[...code.toUpperCase()].map(c => base + c.charCodeAt(0)));
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function loadData() {
  const resp = await browser.runtime.sendMessage({ type: 'GET_STATE' });
  if (resp && resp.ok) {
    _currentState = resp.state;
    _profiles = resp.profiles || [];
    _groups = resp.groups || [];
    if (typeof resp.hasHostPermission === 'boolean') {
      _hasHostPermission = resp.hasHostPermission;
    }
    updateUI();
  }
}

function updatePermissionBanner() {
  const banner = document.getElementById('permission-banner');
  if (banner) {
    banner.style.display = _hasHostPermission ? 'none' : 'flex';
  }
}

function updateStatusStrip() {
  const statusStrip = document.getElementById('status-strip');
  const statusName = document.getElementById('status-name');
  const statusBadge = document.getElementById('status-badge');
  const statusMeta = document.getElementById('status-meta');
  const btnDisconnect = document.getElementById('btn-disconnect');
  const btnDirect = document.getElementById('btn-mode-direct');
  const btnSystem = document.getElementById('btn-mode-system');

  if (!_currentState) return;

  const mode = _currentState.activeMode || 'direct';
  const ip = _currentState.detectedIp;
  const flag = _currentState.detectedGeo?.countryCode ? countryCodeToFlag(_currentState.detectedGeo.countryCode) : '';

  btnDirect.classList.toggle('active', mode === 'direct');
  btnSystem.classList.toggle('active', mode === 'system');

  if (ip) {
    statusMeta.textContent = `IP : ${ip} ${flag}`.trim();
  } else if (_currentState.ipCheckFailed) {
    statusMeta.textContent = 'IP indisponible';
  } else {
    statusMeta.textContent = "Détection de l'IP…";
  }

  if (mode === 'proxy' && _currentState.activeProxy) {
    const activeProf = _profiles.find(p => p.id === _currentState.activeProfileId);
    statusName.textContent = activeProf ? activeProf.name : `${_currentState.activeProxy.protocol.toUpperCase()} ${_currentState.activeProxy.host}:${_currentState.activeProxy.port}`;
    if (!_hasHostPermission) {
      statusStrip.setAttribute('data-state', 'error');
      statusBadge.textContent = 'BLOQUÉ';
      statusMeta.textContent = 'Accès aux sites manquant — trafic direct';
    } else {
      statusStrip.setAttribute('data-state', 'proxy');
      statusBadge.textContent = _currentState.activeProxy.protocol.toUpperCase();
    }
    btnDisconnect.style.display = 'block';
  } else if (mode === 'system') {
    statusStrip.setAttribute('data-state', 'system');
    statusName.textContent = 'Proxy Système';
    statusBadge.textContent = 'Système';
    btnDisconnect.style.display = 'none';
  } else {
    statusStrip.setAttribute('data-state', 'direct');
    statusName.textContent = 'Connexion Directe';
    statusBadge.textContent = 'Direct';
    btnDisconnect.style.display = 'none';
  }
}

function latencyLabel() {
  if (_currentState?.latencyMs != null) return `${_currentState.latencyMs} ms`;
  if (_currentState?.ipCheckFailed) return '—';
  return '…';
}

function renderProfilesList() {
  const container = document.getElementById('profiles-list');
  const emptyState = document.getElementById('profiles-empty');
  container.innerHTML = '';

  const query = _searchFilter.trim().toLowerCase();
  const filtered = _profiles.filter(p => {
    if (!query) return true;
    const nameMatch = p.name.toLowerCase().includes(query);
    const hostMatch = p.host.toLowerCase().includes(query);
    const group = _groups.find(g => g.id === p.groupId);
    const groupMatch = group ? group.name.toLowerCase().includes(query) : false;
    return nameMatch || hostMatch || groupMatch;
  });

  if (_profiles.length === 0) {
    emptyState.style.display = 'flex';
    container.style.display = 'none';
    return;
  }

  emptyState.style.display = 'none';
  container.style.display = 'flex';

  if (filtered.length === 0) {
    container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted);font-size:12px;">Aucun profil ne correspond à la recherche.</div>';
    return;
  }

  // Group profiles
  const groupsMap = new Map();
  // Ungrouped first or last
  groupsMap.set(null, []);
  for (const g of _groups) {
    groupsMap.set(g.id, []);
  }

  for (const p of filtered) {
    const gid = p.groupId && groupsMap.has(p.groupId) ? p.groupId : null;
    groupsMap.get(gid).push(p);
  }

  // Render grouped
  for (const [gid, list] of groupsMap.entries()) {
    if (list.length === 0) continue;

    if (gid !== null) {
      const g = _groups.find(item => item.id === gid);
      if (g) {
        const header = document.createElement('div');
        header.className = 'group-header';
        
        const dot = document.createElement('span');
        dot.className = 'group-header-color';
        dot.style.backgroundColor = g.color || '#3b82f6';
        
        const label = document.createElement('span');
        label.textContent = g.name;
        
        header.appendChild(dot);
        header.appendChild(label);
        container.appendChild(header);
      }
    } else if (groupsMap.size > 1 && list.length > 0 && _groups.length > 0) {
      const header = document.createElement('div');
      header.className = 'group-header';
      const label = document.createElement('span');
      label.textContent = 'Sans groupe';
      header.appendChild(label);
      container.appendChild(header);
    }

    for (const p of list) {
      const isCurrent = _currentState?.activeMode === 'proxy' && _currentState?.activeProfileId === p.id;
      const card = document.createElement('div');
      card.className = `profile-card ${isCurrent ? 'active' : ''}`;
      card.setAttribute('data-id', p.id);

      const colorBar = document.createElement('span');
      colorBar.className = 'profile-color-bar';
      colorBar.style.backgroundColor = p.color || '#3B82F6';

      const details = document.createElement('div');
      details.className = 'profile-details';

      const titleLine = document.createElement('div');
      titleLine.className = 'profile-title-line';
      titleLine.textContent = p.name;

      const metaLine = document.createElement('div');
      metaLine.className = 'profile-meta-line';
      const allowCount = Array.isArray(p.allowList) ? p.allowList.length : 0;
      metaLine.textContent = allowCount
        ? `${p.protocol.toUpperCase()} • ${allowCount} site${allowCount > 1 ? 's' : ''} uniquement`
        : `${p.protocol.toUpperCase()} • ${p.host}:${p.port}`;
      if (allowCount) metaLine.title = p.allowList.join(', ');

      details.appendChild(titleLine);
      details.appendChild(metaLine);

      const actions = document.createElement('div');
      actions.className = 'profile-actions';

      if (isCurrent) {
        const latency = document.createElement('span');
        latency.className = 'profile-latency';
        latency.title = 'Latence mesurée à la connexion';
        latency.textContent = latencyLabel();
        actions.appendChild(latency);

        const activeCheck = document.createElement('div');
        activeCheck.className = 'profile-active-check';
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('width', '14');
        svg.setAttribute('height', '14');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('fill', 'none');
        svg.setAttribute('stroke', 'currentColor');
        svg.setAttribute('stroke-width', '3');
        svg.setAttribute('stroke-linecap', 'round');
        svg.setAttribute('stroke-linejoin', 'round');
        const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
        poly.setAttribute('points', '20 6 9 17 4 12');
        svg.appendChild(poly);
        activeCheck.appendChild(svg);
        actions.appendChild(activeCheck);
      }

      card.appendChild(colorBar);
      card.appendChild(details);
      card.appendChild(actions);

      // Clicking a profile (even the active one) reconnects it and re-detects IP, flag and latency
      card.addEventListener('click', async () => {
        if (!_hasHostPermission) {
          browser.runtime.sendMessage({ type: 'SET_PENDING_CONNECT', profileId: p.id }).catch(() => {});
          const granted = await browser.permissions.request({ origins: ['<all_urls>'] });
          _hasHostPermission = Boolean(granted);
          if (!granted) {
            updateUI();
            return;
          }
        }
        await browser.runtime.sendMessage({ type: 'CONNECT_PROFILE', profileId: p.id });
        await loadData();
      });

      container.appendChild(card);
    }
  }
}

function updateUI() {
  updateStatusStrip();
  updatePermissionBanner();
  renderProfilesList();
}

// Tab navigation
document.querySelectorAll('.nav-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-tab').forEach(b => {
      b.classList.remove('active');
      b.setAttribute('aria-selected', 'false');
    });
    document.querySelectorAll('.tab-panel').forEach(p => p.style.display = 'none');

    btn.classList.add('active');
    btn.setAttribute('aria-selected', 'true');
    const target = document.getElementById(btn.getAttribute('data-target'));
    if (target) target.style.display = 'flex';
  });
});

// Search filter
document.getElementById('profiles-search').addEventListener('input', (e) => {
  _searchFilter = e.target.value;
  renderProfilesList();
});

// Open options page
document.getElementById('btn-open-options').addEventListener('click', () => {
  browser.runtime.openOptionsPage();
});

document.getElementById('btn-add-profile-popup').addEventListener('click', () => {
  browser.runtime.openOptionsPage();
});

document.getElementById('btn-create-first-profile').addEventListener('click', () => {
  browser.runtime.openOptionsPage();
});

// Direct and System mode switches
document.getElementById('btn-mode-direct').addEventListener('click', async () => {
  await browser.runtime.sendMessage({ type: 'SET_MODE', mode: 'direct' });
  await loadData();
});

document.getElementById('btn-mode-system').addEventListener('click', async () => {
  await browser.runtime.sendMessage({ type: 'SET_MODE', mode: 'system' });
  await loadData();
});

// Disconnect
document.getElementById('btn-disconnect').addEventListener('click', async () => {
  await browser.runtime.sendMessage({ type: 'DISCONNECT' });
  await loadData();
});

// Refresh IP
document.getElementById('btn-refresh-ip').addEventListener('click', async () => {
  await browser.runtime.sendMessage({ type: 'REFRESH_IP' });
  await loadData();
});

// Grant host permission button
document.getElementById('btn-grant-permission').addEventListener('click', async () => {
  const granted = await browser.permissions.request({ origins: ['<all_urls>'] });
  _hasHostPermission = Boolean(granted);
  await loadData();
});

// The IP check finishes after the connect call returns: re-render when its result lands
const LIVE_STATE_KEYS = ['detectedIp', 'detectedGeo', 'latencyMs', 'ipCheckFailed', 'activeMode', 'activeProfileId', 'lastError'];
browser.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (LIVE_STATE_KEYS.some(key => key in changes)) loadData();
});
browser.permissions?.onAdded?.addListener(() => { loadData(); });
browser.permissions?.onRemoved?.addListener(() => { loadData(); });

// Manual form handling
const manualForm = document.getElementById('manual-form');
const manualFeedback = document.getElementById('manual-feedback');

function showManualFeedback(msg, type = 'info') {
  manualFeedback.style.display = 'block';
  manualFeedback.className = `manual-feedback ${type}`;
  manualFeedback.textContent = msg;
}

document.getElementById('btn-test-manual').addEventListener('click', async () => {
  const protocol = document.getElementById('manual-protocol').value;
  const host = document.getElementById('manual-host').value.trim();
  const port = parseInt(document.getElementById('manual-port').value, 10);
  const username = document.getElementById('manual-user').value.trim() || null;
  const password = document.getElementById('manual-pass').value || null;

  if (!host || !port) {
    showManualFeedback('Veuillez renseigner un hôte et un port valides.', 'error');
    return;
  }

  if (!_hasHostPermission) {
    const granted = await browser.permissions.request({ origins: ['<all_urls>'] });
    _hasHostPermission = Boolean(granted);
    if (!granted) {
      updateUI();
      showManualFeedback("Autorisation d'accès aux sites requise pour tester le proxy.", 'error');
      return;
    }
  }

  showManualFeedback('Test de connexion en cours...', 'info');
  const resp = await browser.runtime.sendMessage({
    type: 'TEST_PROXY',
    config: { protocol, host, port, username, password }
  });

  if (resp?.ok && resp.result?.ok) {
    const flag = resp.result.countryCode ? countryCodeToFlag(resp.result.countryCode) : '';
    showManualFeedback(`Connexion réussie ! IP: ${resp.result.ip} ${flag} (${resp.result.latencyMs} ms)`, 'success');
  } else {
    showManualFeedback(`Échec du test : ${resp?.result?.error || 'inaccessible'}`, 'error');
  }
});

manualForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const protocol = document.getElementById('manual-protocol').value;
  const host = document.getElementById('manual-host').value.trim();
  const port = parseInt(document.getElementById('manual-port').value, 10);
  const username = document.getElementById('manual-user').value.trim() || null;
  const password = document.getElementById('manual-pass').value || null;

  if (!host || !port) {
    showManualFeedback('Veuillez renseigner un hôte et un port valides.', 'error');
    return;
  }

  const config = { protocol, host, port, username, password };
  if (!_hasHostPermission) {
    browser.runtime.sendMessage({ type: 'SET_PENDING_CONNECT', config }).catch(() => {});
    const granted = await browser.permissions.request({ origins: ['<all_urls>'] });
    _hasHostPermission = Boolean(granted);
    if (!granted) {
      updateUI();
      showManualFeedback("Autorisation d'accès aux sites requise pour utiliser le proxy.", 'error');
      return;
    }
  }

  showManualFeedback('Connexion en cours...', 'info');
  const resp = await browser.runtime.sendMessage({
    type: 'CONNECT_MANUAL',
    config
  });

  if (resp?.ok) {
    showManualFeedback('Connecté avec succès.', 'success');
    await loadData();
  } else {
    showManualFeedback(`Erreur : ${resp?.error || 'impossible de se connecter'}`, 'error');
  }
});

loadData();
