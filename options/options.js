'use strict';

let _profiles = [];
let _groups = [];
let _activeGroupFilter = 'all';
let _parsedImportProxies = [];

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
    _profiles = resp.profiles || [];
    _groups = resp.groups || [];
    renderAll();
  }
}

function renderAll() {
  renderGroupFilterBar();
  renderProfilesTable();
  populateGroupDropdowns();
}

function populateGroupDropdowns() {
  const groupSelect = document.getElementById('f-profile-group');
  const importGroupSelect = document.getElementById('import-target-group');

  groupSelect.replaceChildren(new Option('(Aucun groupe)', ''));
  importGroupSelect.replaceChildren(new Option('(Aucun groupe)', ''));

  for (const g of _groups) {
    groupSelect.appendChild(new Option(g.name, g.id));
    importGroupSelect.appendChild(new Option(g.name, g.id));
  }
}

function renderGroupFilterBar() {
  const bar = document.getElementById('groups-filter-bar');
  bar.replaceChildren();

  const allBtn = document.createElement('button');
  allBtn.className = `group-chip ${_activeGroupFilter === 'all' ? 'active' : ''}`;
  allBtn.textContent = `Tous (${_profiles.length})`;
  allBtn.addEventListener('click', () => {
    _activeGroupFilter = 'all';
    renderAll();
  });
  bar.appendChild(allBtn);

  for (const g of _groups) {
    const count = _profiles.filter(p => p.groupId === g.id).length;
    const chip = document.createElement('button');
    chip.className = `group-chip ${_activeGroupFilter === g.id ? 'active' : ''}`;
    
    const dot = document.createElement('span');
    dot.className = 'chip-color-dot';
    dot.style.backgroundColor = g.color || '#3b82f6';

    const label = document.createElement('span');
    label.textContent = `${g.name} (${count})`;

    const delBtn = document.createElement('span');
    delBtn.className = 'chip-delete-btn';
    delBtn.title = 'Supprimer ce groupe';
    delBtn.textContent = '×';

    chip.appendChild(dot);
    chip.appendChild(label);
    chip.appendChild(delBtn);

    chip.addEventListener('click', (e) => {
      if (e.target.classList.contains('chip-delete-btn')) {
        e.stopPropagation();
        if (confirm(`Supprimer le groupe « ${g.name} » ? Les profils associés ne seront pas supprimés.`)) {
          browser.runtime.sendMessage({ type: 'DELETE_GROUP', groupId: g.id }).then(() => {
            if (_activeGroupFilter === g.id) _activeGroupFilter = 'all';
            loadData();
          });
        }
        return;
      }
      _activeGroupFilter = g.id;
      renderAll();
    });

    bar.appendChild(chip);
  }

  const ungroupedCount = _profiles.filter(p => !p.groupId).length;
  if (_groups.length > 0 && ungroupedCount > 0) {
    const chip = document.createElement('button');
    chip.className = `group-chip ${_activeGroupFilter === 'ungrouped' ? 'active' : ''}`;
    chip.textContent = `Sans groupe (${ungroupedCount})`;
    chip.addEventListener('click', () => {
      _activeGroupFilter = 'ungrouped';
      renderAll();
    });
    bar.appendChild(chip);
  }
}

// Icon paths (24x24, stroked), built with DOM APIs rather than innerHTML.
const ICON_EDIT = ['M12 20h9', 'M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z'];
const ICON_DELETE = ['M3 6h18', 'M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6', 'M10 11v6', 'M14 11v6', 'M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2'];
const SVG_NS = 'http://www.w3.org/2000/svg';

function makeIconButton(label, paths, extraClass = '') {
  const btn = document.createElement('button');
  btn.className = `btn-icon ${extraClass}`.trim();
  btn.title = label;
  btn.setAttribute('aria-label', label);

  const svg = document.createElementNS(SVG_NS, 'svg');
  const attrs = { width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
    'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
  for (const [k, v] of Object.entries(attrs)) svg.setAttribute(k, v);
  for (const d of paths) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
  }
  btn.appendChild(svg);
  return btn;
}

function makeCell(className) {
  const cell = document.createElement('div');
  cell.className = `profile-cell ${className}`;
  return cell;
}

function renderProfilesTable() {
  const list = document.getElementById('profiles-list');
  const empty = document.getElementById('table-empty');
  list.replaceChildren();

  let profiles = _profiles;
  if (_activeGroupFilter === 'ungrouped') {
    profiles = profiles.filter(p => !p.groupId);
  } else if (_activeGroupFilter !== 'all') {
    profiles = profiles.filter(p => p.groupId === _activeGroupFilter);
  }

  if (profiles.length === 0) {
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  for (const p of profiles) {
    const group = _groups.find(g => g.id === p.groupId);
    const row = document.createElement('div');
    row.className = 'profile-row';

    // Profile: color, name, group underneath
    const cellProfile = makeCell('cell-profile');
    const bullet = document.createElement('span');
    bullet.className = 'color-bullet';
    bullet.style.backgroundColor = p.color || '#3B82F6';
    const nameWrap = document.createElement('div');
    nameWrap.className = 'profile-name-wrap';
    const name = document.createElement('strong');
    name.className = 'profile-name';
    name.textContent = p.name;
    name.title = p.name;
    nameWrap.appendChild(name);
    if (group) {
      const gTag = document.createElement('span');
      gTag.className = 'group-tag';
      const gDot = document.createElement('span');
      gDot.className = 'chip-color-dot';
      gDot.style.backgroundColor = group.color || '#3b82f6';
      const gName = document.createElement('span');
      gName.textContent = group.name;
      gTag.append(gDot, gName);
      nameWrap.appendChild(gTag);
    }
    cellProfile.append(bullet, nameWrap);

    // Server: protocol + host:port
    const cellServer = makeCell('cell-server');
    const protoTag = document.createElement('span');
    protoTag.className = 'proto-tag';
    protoTag.textContent = p.protocol.toUpperCase();
    const host = document.createElement('code');
    host.className = 'truncate';
    host.textContent = `${p.host}:${p.port}`;
    host.title = host.textContent;
    cellServer.append(protoTag, host);

    // Username, truncated (full value on hover)
    const cellUser = makeCell('cell-user');
    if (p.username) {
      const user = document.createElement('code');
      user.className = 'truncate';
      user.textContent = p.username;
      user.title = p.username;
      cellUser.appendChild(user);
    } else {
      const dim = document.createElement('span');
      dim.className = 'text-dim';
      dim.textContent = 'Sans authentification';
      cellUser.appendChild(dim);
    }

    // Actions
    const cellActions = makeCell('cell-actions');
    const btnEdit = makeIconButton('Modifier', ICON_EDIT);
    const btnDelete = makeIconButton('Supprimer', ICON_DELETE, 'btn-icon-danger');
    cellActions.append(btnEdit, btnDelete);

    btnEdit.addEventListener('click', () => openProfileModal(p));
    btnDelete.addEventListener('click', async () => {
      if (confirm(`Supprimer définitivement le profil « ${p.name} » ?`)) {
        await browser.runtime.sendMessage({ type: 'DELETE_PROFILE', profileId: p.id });
        await loadData();
      }
    });

    row.append(cellProfile, cellServer, cellUser, cellActions);
    list.appendChild(row);
  }
}

// Modal handling
const modalProfile = document.getElementById('modal-profile');
const modalGroup = document.getElementById('modal-group');
const profileForm = document.getElementById('profile-form');
const groupForm = document.getElementById('group-form');

function openProfileModal(profile = null) {
  document.getElementById('profile-modal-title').textContent = profile ? 'Modifier le profil' : 'Nouveau Profil';
  document.getElementById('f-profile-id').value = profile?.id || '';
  document.getElementById('f-profile-name').value = profile?.name || '';
  document.getElementById('f-profile-color').value = profile?.color || '#3B82F6';
  document.getElementById('f-profile-proto').value = profile?.protocol || 'socks5';
  document.getElementById('f-profile-host').value = profile?.host || '';
  document.getElementById('f-profile-port').value = profile?.port || '1080';
  document.getElementById('f-profile-user').value = profile?.username || '';
  document.getElementById('f-profile-pass').value = profile?.password || '';
  document.getElementById('f-profile-group').value = profile?.groupId || '';

  const bypass = profile?.bypassList || ['localhost', '127.0.0.1', '[::1]'];
  document.getElementById('f-profile-bypass').value = Array.isArray(bypass) ? bypass.join('\n') : bypass;
  document.getElementById('f-profile-allow').value = (profile?.allowList || []).join('\n');

  modalProfile.style.display = 'flex';
}

function closeProfileModal() {
  modalProfile.style.display = 'none';
  profileForm.reset();
}

function openGroupModal() {
  document.getElementById('f-group-id').value = '';
  document.getElementById('f-group-name').value = '';
  document.getElementById('f-group-color').value = '#10B981';
  modalGroup.style.display = 'flex';
}

function closeGroupModal() {
  modalGroup.style.display = 'none';
  groupForm.reset();
}

document.getElementById('btn-open-profile-modal').addEventListener('click', () => openProfileModal());
document.getElementById('btn-close-profile-modal').addEventListener('click', closeProfileModal);
document.getElementById('btn-cancel-profile').addEventListener('click', closeProfileModal);

document.getElementById('btn-open-group-modal').addEventListener('click', openGroupModal);
document.getElementById('btn-close-group-modal').addEventListener('click', closeGroupModal);
document.getElementById('btn-cancel-group').addEventListener('click', closeGroupModal);

profileForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const bypassStr = document.getElementById('f-profile-bypass').value;
  const bypassList = bypassStr.split(/[\r\n]+/).map(s => s.trim()).filter(Boolean);
  const allowList = document.getElementById('f-profile-allow').value.split(/[\r\n]+/).map(s => s.trim()).filter(Boolean);

  const profileData = {
    id: document.getElementById('f-profile-id').value || undefined,
    name: document.getElementById('f-profile-name').value.trim(),
    color: document.getElementById('f-profile-color').value,
    protocol: document.getElementById('f-profile-proto').value,
    host: document.getElementById('f-profile-host').value.trim(),
    port: parseInt(document.getElementById('f-profile-port').value, 10),
    username: document.getElementById('f-profile-user').value.trim() || null,
    password: document.getElementById('f-profile-pass').value || null,
    groupId: document.getElementById('f-profile-group').value || null,
    bypassList: bypassList.length ? bypassList : ['localhost', '127.0.0.1', '[::1]'],
    allowList
  };

  await browser.runtime.sendMessage({
    type: 'SAVE_PROFILE',
    profile: profileData
  });

  closeProfileModal();
  await loadData();
});

groupForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const groupData = {
    id: document.getElementById('f-group-id').value || undefined,
    name: document.getElementById('f-group-name').value.trim(),
    color: document.getElementById('f-group-color').value
  };

  await browser.runtime.sendMessage({
    type: 'SAVE_GROUP',
    group: groupData
  });

  closeGroupModal();
  await loadData();
});

// Tab Navigation in Sidebar
document.querySelectorAll('.side-nav .nav-item').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.side-nav .nav-item').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach(p => p.style.display = 'none');

    btn.classList.add('active');
    const target = document.getElementById(btn.getAttribute('data-tab'));
    if (target) target.style.display = 'flex';
  });
});

// Mass Import logic
const importTextarea = document.getElementById('import-textarea');
const importPreviewBox = document.getElementById('import-preview-box');
const importCountLabel = document.getElementById('import-count-label');
const importPreviewList = document.getElementById('import-preview-list');
const btnExecuteImport = document.getElementById('btn-execute-import');

function parseImportLine(line, defaultProto) {
  const clean = line.trim();
  if (!clean || clean.startsWith('#')) return null;

  // 1. URI format: protocol://user:pass@host:port or protocol://host:port
  const uriMatch = clean.match(/^([a-zA-Z0-9]+):\/\/(?:([^:@]+)(?::([^@]+))?@)?([^:@\s]+):(\d+)$/);
  if (uriMatch) {
    return {
      protocol: uriMatch[1].toLowerCase(),
      username: uriMatch[2] || null,
      password: uriMatch[3] || null,
      host: uriMatch[4],
      port: parseInt(uriMatch[5], 10)
    };
  }

  // 2. user:pass@host:port
  const authAtMatch = clean.match(/^([^:@\s]+):([^:@\s]+)@([^:@\s]+):(\d+)$/);
  if (authAtMatch) {
    return {
      protocol: defaultProto,
      username: authAtMatch[1],
      password: authAtMatch[2],
      host: authAtMatch[3],
      port: parseInt(authAtMatch[4], 10)
    };
  }

  // 3. host:port:user:pass
  const hostPortAuthMatch = clean.match(/^([^:@\s]+):(\d+):([^:@\s]+):([^:@\s]+)$/);
  if (hostPortAuthMatch) {
    return {
      protocol: defaultProto,
      host: hostPortAuthMatch[1],
      port: parseInt(hostPortAuthMatch[2], 10),
      username: hostPortAuthMatch[3],
      password: hostPortAuthMatch[4]
    };
  }

  // 4. host:port
  const hostPortMatch = clean.match(/^([^:@\s]+):(\d+)$/);
  if (hostPortMatch) {
    return {
      protocol: defaultProto,
      host: hostPortMatch[1],
      port: parseInt(hostPortMatch[2], 10),
      username: null,
      password: null
    };
  }

  return null;
}

function parseImportText() {
  const text = importTextarea.value.trim();
  const defaultProto = document.getElementById('import-default-proto').value;
  _parsedImportProxies = [];

  if (!text) {
    importPreviewBox.style.display = 'none';
    return;
  }

  // Check if JSON array
  if (text.startsWith('[') || text.startsWith('{')) {
    try {
      const parsedJson = JSON.parse(text);
      const arr = Array.isArray(parsedJson) ? parsedJson : parsedJson.proxies || [];
      for (const item of arr) {
        if (item.host && item.port) {
          _parsedImportProxies.push({
            name: item.name || `${item.protocol || defaultProto} ${item.host}:${item.port}`,
            protocol: item.protocol || defaultProto,
            host: String(item.host).trim(),
            port: parseInt(item.port, 10),
            username: item.username || item.user || null,
            password: item.password || item.pass || null
          });
        }
      }
    } catch (_) {}
  }

  // If not JSON, parse lines
  if (_parsedImportProxies.length === 0) {
    const lines = text.split(/[\r\n]+/);
    for (const line of lines) {
      const parsed = parseImportLine(line, defaultProto);
      if (parsed) {
        _parsedImportProxies.push(parsed);
      }
    }
  }

  if (_parsedImportProxies.length > 0) {
    importPreviewBox.style.display = 'flex';
    importCountLabel.textContent = `${_parsedImportProxies.length} proxy/proxies valide(s) détecté(s)`;
    importPreviewList.replaceChildren();
    
    for (const p of _parsedImportProxies.slice(0, 10)) {
      const item = document.createElement('div');
      const auth = p.username ? ` (${p.username}:*****)` : '';
      item.textContent = `• ${p.protocol.toUpperCase()} ${p.host}:${p.port}${auth}`;
      importPreviewList.appendChild(item);
    }

    if (_parsedImportProxies.length > 10) {
      const more = document.createElement('div');
      more.textContent = `... et ${_parsedImportProxies.length - 10} autre(s)`;
      importPreviewList.appendChild(more);
    }
  } else {
    importPreviewBox.style.display = 'none';
  }
}

importTextarea.addEventListener('input', parseImportText);
document.getElementById('import-default-proto').addEventListener('change', parseImportText);

btnExecuteImport.addEventListener('click', async () => {
  if (_parsedImportProxies.length === 0) return;

  const targetGroupId = document.getElementById('import-target-group').value || null;
  btnExecuteImport.disabled = true;
  btnExecuteImport.textContent = 'Importation...';

  const resp = await browser.runtime.sendMessage({
    type: 'IMPORT_PROFILES',
    profiles: _parsedImportProxies,
    groupId: targetGroupId
  });

  btnExecuteImport.disabled = false;
  btnExecuteImport.textContent = "Valider l'importation";

  if (resp && resp.ok) {
    alert(`${resp.count} profils importés avec succès.`);
    importTextarea.value = '';
    importPreviewBox.style.display = 'none';
    _parsedImportProxies = [];

    // Switch back to Profiles tab
    document.querySelector('.side-nav .nav-item[data-tab="tab-profiles"]').click();
    await loadData();
  } else {
    alert(`Erreur lors de l'import : ${resp?.error || 'inconnue'}`);
  }
});

// Backup: export / import of all profiles and groups
let _pendingBackup = null;
const backupFileInput = document.getElementById('input-backup-file');
const backupPreviewBox = document.getElementById('backup-preview-box');
const backupPreviewLabel = document.getElementById('backup-preview-label');
const btnExecuteBackupImport = document.getElementById('btn-execute-backup-import');

document.getElementById('btn-export-config').addEventListener('click', async () => {
  const resp = await browser.runtime.sendMessage({ type: 'EXPORT_CONFIG' });
  if (!resp?.ok) {
    alert(`Erreur lors de l'export : ${resp?.error || 'inconnue'}`);
    return;
  }
  const blob = new Blob([JSON.stringify(resp.backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `zen-proxy-manager-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

document.getElementById('btn-pick-backup').addEventListener('click', () => backupFileInput.click());

backupFileInput.addEventListener('change', async () => {
  const file = backupFileInput.files[0];
  backupFileInput.value = '';
  if (!file) return;

  try {
    const backup = JSON.parse(await file.text());
    if (backup.format !== 'zen-proxy-manager-backup') throw new Error();
    const profiles = Array.isArray(backup.profiles) ? backup.profiles.length : 0;
    const groups = Array.isArray(backup.groups) ? backup.groups.length : 0;
    _pendingBackup = backup;
    backupPreviewLabel.textContent = `${file.name} : ${profiles} profil(s), ${groups} groupe(s)`;
    backupPreviewBox.style.display = 'flex';
  } catch (_) {
    _pendingBackup = null;
    backupPreviewBox.style.display = 'none';
    alert("Ce fichier n'est pas une sauvegarde Zen Proxy Manager.");
  }
});

btnExecuteBackupImport.addEventListener('click', async () => {
  if (!_pendingBackup) return;
  btnExecuteBackupImport.disabled = true;

  const resp = await browser.runtime.sendMessage({ type: 'IMPORT_CONFIG', backup: _pendingBackup });

  btnExecuteBackupImport.disabled = false;
  if (!resp?.ok) {
    alert(`Erreur lors de l'import : ${resp?.error || 'inconnue'}`);
    return;
  }
  _pendingBackup = null;
  backupPreviewBox.style.display = 'none';
  alert(`Import terminé : ${resp.profilesAdded} profil(s) ajouté(s), ${resp.profilesUpdated} mis à jour, ${resp.groupsAdded} groupe(s) ajouté(s).`);
  document.querySelector('.side-nav .nav-item[data-tab="tab-profiles"]').click();
  await loadData();
});

document.getElementById('version-label').textContent = `Zen Proxy Manager v${browser.runtime.getManifest().version}`;

loadData();
