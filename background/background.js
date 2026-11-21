'use strict';

const BADGE_COLOR_ACTIVE = '#3D8B55';
const BADGE_COLOR_ERROR = '#E3401F';
const BADGE_COLOR_SYSTEM = '#5C5B55';
const HOST_PERMISSION_FILTER = { origins: ['<all_urls>'] };
const HOST_PERMISSION_ERROR = 'HOST_PERMISSION_MISSING';
const PENDING_CONNECT_KEY = 'pendingConnect';

let _pendingConnect = null;

async function hasHostPermissions() {
  try {
    return await browser.permissions.contains(HOST_PERMISSION_FILTER);
  } catch (_) {
    return false;
  }
}

function clearPendingConnect() {
  _pendingConnect = null;
  browser.storage.session?.remove(PENDING_CONNECT_KEY).catch(() => {});
}

async function updateBadge(mode, isError = false) {
  if (isError) {
    await browser.action.setBadgeText({ text: 'ERR' });
    await browser.action.setBadgeBackgroundColor({ color: BADGE_COLOR_ERROR });
    return;
  }
  if (mode === 'proxy') {
    await browser.action.setBadgeText({ text: 'ON' });
    await browser.action.setBadgeBackgroundColor({ color: BADGE_COLOR_ACTIVE });
  } else if (mode === 'system') {
    await browser.action.setBadgeText({ text: 'SYS' });
    await browser.action.setBadgeBackgroundColor({ color: BADGE_COLOR_SYSTEM });
  } else {
    await browser.action.setBadgeText({ text: '' });
  }
}

// Bumped on every connection change so a slow check started for a previous
// profile can't overwrite the IP of the one connected after it.
let _ipCheckGeneration = 0;

const IP_CHECK_ATTEMPTS = 3;

async function refreshIpAndStore() {
  const state = await getProxyState();
  if (state.activeMode === 'proxy' && !(await hasHostPermissions())) {
    await setProxyState({
      detectedIp: null,
      detectedGeo: null,
      latencyMs: null,
      ipCheckFailed: true,
      lastError: HOST_PERMISSION_ERROR
    });
    await updateBadge('proxy', true);
    return null;
  }

  const generation = _ipCheckGeneration;
  let result = null;
  // The first request on a fresh residential connection can be very slow: retry before giving up
  for (let attempt = 0; attempt < IP_CHECK_ATTEMPTS && !result?.ip; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, 1000));
    if (generation !== _ipCheckGeneration) return null;
    result = await detectCurrentExitIp();
  }
  if (generation !== _ipCheckGeneration) return null;

  if (result && result.ip) {
    await setProxyState({
      detectedIp: result.ip,
      detectedGeo: result.countryCode ? { countryCode: result.countryCode } : null,
      latencyMs: result.latencyMs ?? null,
      ipCheckFailed: false
    });
    return result;
  }
  await setProxyState({ ipCheckFailed: true });
  return null;
}

// Clears the previous IP right away (the popup shows "detecting") and starts a fresh check.
async function startIpCheck() {
  _ipCheckGeneration++;
  await setProxyState({ detectedIp: null, detectedGeo: null, latencyMs: null, ipCheckFailed: false });
  refreshIpAndStore().catch(() => {});
}

// Connects to a proxy and remembers the connection host, so that a background wake-up
// reuses the same connection instead of opening a new one (which may change the exit IP).
async function connectProxy(config, activeProfileId) {
  const host = pickConnectionHost(config);
  const hostPerm = await hasHostPermissions();
  applyProxyMode(config, host);
  if (!hostPerm) {
    await setProxyState({
      activeMode: 'proxy',
      activeProfileId,
      activeProxy: config,
      activeProxyHost: host,
      detectedIp: null,
      detectedGeo: null,
      latencyMs: null,
      ipCheckFailed: true,
      lastError: HOST_PERMISSION_ERROR
    });
    await updateBadge('proxy', true);
    return;
  }
  await setProxyState({
    activeMode: 'proxy',
    activeProfileId,
    activeProxy: config,
    activeProxyHost: host,
    lastError: null
  });
  await updateBadge('proxy');
  await startIpCheck();
}

// Runs every time the background starts: browser startup, but also each wake-up after Zen
// suspended it. It only restores the state; the IP is checked on browser startup and on
// connection changes, not on every wake-up.
async function initialize() {
  let hostPerm = true;
  try {
    const state = await getProxyState();
    hostPerm = await hasHostPermissions();
    await restoreTabRoutes();
    if (state.activeMode === 'proxy' && state.activeProxy) {
      applyProxyMode(state.activeProxy, state.activeProxyHost || state.activeProxy.host, { keepTabRoutes: true });
      if (!hostPerm && state.lastError !== HOST_PERMISSION_ERROR) {
        await setProxyState({
          detectedIp: null,
          detectedGeo: null,
          latencyMs: null,
          ipCheckFailed: true,
          lastError: HOST_PERMISSION_ERROR
        });
      } else if (hostPerm && state.lastError === HOST_PERMISSION_ERROR) {
        await setProxyState({ lastError: null });
      }
    } else if (state.activeMode === 'system') {
      applySystemMode();
    } else {
      applyDirectMode();
    }
  } finally {
    markEngineReady();
  }
  const { activeMode } = await getProxyState();
  await updateBadge(activeMode, activeMode === 'proxy' && !hostPerm);
}

browser.runtime.onStartup.addListener(() => { startIpCheck().catch(() => {}); });
browser.runtime.onInstalled.addListener(() => { startIpCheck().catch(() => {}); });

// Runtime messages handler
browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const handle = async () => {
    switch (message.type) {
      case 'GET_STATE': {
        const state = await getProxyState();
        const profiles = await loadProfiles();
        const groups = await loadGroups();
        const hasHostPermission = await hasHostPermissions();
        return { ok: true, state, profiles, groups, hasHostPermission };
      }

      case 'SET_PENDING_CONNECT': {
        const pending = {
          profileId: message.profileId || null,
          config: message.config || null,
          ts: Date.now()
        };
        _pendingConnect = pending;
        await browser.storage.session?.set({ [PENDING_CONNECT_KEY]: pending }).catch(() => {});
        return { ok: true };
      }

      case 'CONNECT_PROFILE': {
        clearPendingConnect();
        const profiles = await loadProfiles();
        const profile = profiles.find(p => p.id === message.profileId);
        if (!profile) throw new Error('Profile not found');

        await connectProxy(profile, profile.id);
        return { ok: true, profile };
      }

      case 'CONNECT_MANUAL': {
        clearPendingConnect();
        const config = makeProfile(message.config);
        await connectProxy(config, null);
        return { ok: true, config };
      }

      case 'DISCONNECT': {
        clearPendingConnect();
        applyDirectMode();
        await setProxyState({
          activeMode: 'direct',
          activeProfileId: null,
          activeProxy: null,
          activeProxyHost: null,
          lastError: null
        });
        await updateBadge('direct');
        await startIpCheck();
        return { ok: true };
      }

      case 'SET_MODE': {
        clearPendingConnect();
        const mode = message.mode === 'system' ? 'system' : 'direct';
        if (mode === 'system') {
          applySystemMode();
        } else {
          applyDirectMode();
        }
        await setProxyState({
          activeMode: mode,
          activeProfileId: null,
          activeProxy: null,
          activeProxyHost: null,
          lastError: null
        });
        await updateBadge(mode);
        await startIpCheck();
        return { ok: true, mode };
      }

      case 'TEST_PROXY': {
        if (!(await hasHostPermissions())) {
          return {
            ok: true,
            result: { ok: false, error: "Autorisation d'accès aux sites manquante" }
          };
        }
        const config = message.config;
        const result = await runProxyTest(config);
        return { ok: true, result };
      }

      case 'REFRESH_IP': {
        await startIpCheck();
        return { ok: true };
      }

      case 'SAVE_PROFILE': {
        const profiles = await loadProfiles();
        const profileData = message.profile;
        let savedProfile;

        const existingIdx = profiles.findIndex(p => p.id === profileData.id);
        if (existingIdx >= 0) {
          savedProfile = {
            ...profiles[existingIdx],
            ...profileData,
            port: parseInt(profileData.port, 10) || profiles[existingIdx].port
          };
          profiles[existingIdx] = savedProfile;
        } else {
          savedProfile = makeProfile(profileData);
          profiles.push(savedProfile);
        }

        await saveProfiles(profiles);

        // If the edited profile is active, reapply it
        const state = await getProxyState();
        if (state.activeMode === 'proxy' && state.activeProfileId === savedProfile.id) {
          await connectProxy(savedProfile, savedProfile.id);
        }

        return { ok: true, profile: savedProfile };
      }

      case 'DELETE_PROFILE': {
        const profiles = await loadProfiles();
        const updated = profiles.filter(p => p.id !== message.profileId);
        await saveProfiles(updated);

        const state = await getProxyState();
        if (state.activeProfileId === message.profileId) {
          applyDirectMode();
          await setProxyState({
            activeMode: 'direct',
            activeProfileId: null,
            activeProxy: null,
            activeProxyHost: null
          });
          await updateBadge('direct');
          await startIpCheck();
        }
        return { ok: true };
      }

      case 'SAVE_GROUP': {
        const groups = await loadGroups();
        const groupData = message.group;
        let savedGroup;

        const existingIdx = groups.findIndex(g => g.id === groupData.id);
        if (existingIdx >= 0) {
          savedGroup = { ...groups[existingIdx], ...groupData };
          groups[existingIdx] = savedGroup;
        } else {
          savedGroup = makeGroup(groupData.name, groupData.color);
          groups.push(savedGroup);
        }

        await saveGroups(groups);
        return { ok: true, group: savedGroup };
      }

      case 'DELETE_GROUP': {
        const groups = await loadGroups();
        const updatedGroups = groups.filter(g => g.id !== message.groupId);
        await saveGroups(updatedGroups);

        // Unlink profiles in this group
        const profiles = await loadProfiles();
        let changed = false;
        for (const p of profiles) {
          if (p.groupId === message.groupId) {
            p.groupId = null;
            changed = true;
          }
        }
        if (changed) await saveProfiles(profiles);

        return { ok: true };
      }

      case 'IMPORT_PROFILES': {
        const current = await loadProfiles();
        const newProfiles = (message.profiles || []).map(p => {
          const item = makeProfile(p);
          if (message.groupId) item.groupId = message.groupId;
          return item;
        });
        const combined = [...current, ...newProfiles];
        await saveProfiles(combined);
        return { ok: true, count: newProfiles.length };
      }

      case 'EXPORT_CONFIG': {
        return {
          ok: true,
          backup: {
            format: BACKUP_FORMAT,
            version: BACKUP_VERSION,
            exportedAt: new Date().toISOString(),
            groups: await loadGroups(),
            profiles: await loadProfiles()
          }
        };
      }

      case 'IMPORT_CONFIG': {
        const backup = message.backup || {};
        if (backup.format !== BACKUP_FORMAT) throw new Error('Fichier non reconnu (pas une sauvegarde Zen Proxy Manager)');

        // Merge by id: re-importing the same file updates entries instead of duplicating them.
        const groups = await loadGroups();
        let groupsAdded = 0;
        for (const g of Array.isArray(backup.groups) ? backup.groups : []) {
          if (!g || !g.id || !g.name) continue;
          const item = { ...makeGroup(g.name, g.color), id: g.id, createdAt: g.createdAt || Date.now() };
          const idx = groups.findIndex(x => x.id === item.id);
          if (idx >= 0) groups[idx] = item; else { groups.push(item); groupsAdded++; }
        }
        await saveGroups(groups);

        const profiles = await loadProfiles();
        let profilesAdded = 0, profilesUpdated = 0;
        const importedIds = new Set();
        for (const p of Array.isArray(backup.profiles) ? backup.profiles : []) {
          if (!p || !p.id || !p.host) continue;
          const item = makeProfile(p);
          if (item.groupId && !groups.some(g => g.id === item.groupId)) item.groupId = null;
          const idx = profiles.findIndex(x => x.id === item.id);
          if (idx >= 0) { profiles[idx] = item; profilesUpdated++; } else { profiles.push(item); profilesAdded++; }
          importedIds.add(item.id);
        }
        await saveProfiles(profiles);

        const state = await getProxyState();
        const active = state.activeMode === 'proxy' && importedIds.has(state.activeProfileId)
          && profiles.find(p => p.id === state.activeProfileId);
        if (active) await connectProxy(active, active.id);

        return { ok: true, groupsAdded, profilesAdded, profilesUpdated };
      }

      default:
        return { ok: false, error: 'Unknown message type' };
    }
  };

  handle()
    .then(sendResponse)
    .catch(err => sendResponse({ ok: false, error: err.message || String(err) }));

  return true; // Keep message channel open for async response
});

// Periodic exit IP refresh every 5 minutes using alarms (lightweight, no active timers).
// Created only once: re-creating it on every wake-up would keep postponing it.
browser.alarms.get('refreshIpAlarm').then((alarm) => {
  if (!alarm) browser.alarms.create('refreshIpAlarm', { periodInMinutes: 5 });
});
browser.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'refreshIpAlarm') {
    refreshIpAndStore().catch(() => {});
  }
});

async function handlePermissionsChange() {
  const hostPerm = await hasHostPermissions();
  const state = await getProxyState();

  if (hostPerm) {
    reregisterProxyListener();
    let pending = _pendingConnect;
    if (!pending) {
      try {
        pending = (await browser.storage.session?.get(PENDING_CONNECT_KEY))?.[PENDING_CONNECT_KEY] || null;
      } catch (_) {}
    }
    clearPendingConnect();

    if (pending && Date.now() - pending.ts < 60000) {
      if (pending.profileId) {
        const profiles = await loadProfiles();
        const profile = profiles.find(p => p.id === pending.profileId);
        if (profile) {
          await connectProxy(profile, profile.id);
          return;
        }
      } else if (pending.config) {
        await connectProxy(makeProfile(pending.config), null);
        return;
      }
    }

    if (state.activeMode === 'proxy' && state.activeProxy) {
      applyProxyMode(state.activeProxy, state.activeProxyHost || state.activeProxy.host, { keepTabRoutes: true });
      await setProxyState({ lastError: null });
      await updateBadge('proxy');
      await startIpCheck();
    }
  } else if (state.activeMode === 'proxy') {
    await setProxyState({
      detectedIp: null,
      detectedGeo: null,
      latencyMs: null,
      ipCheckFailed: true,
      lastError: HOST_PERMISSION_ERROR
    });
    await updateBadge('proxy', true);
  }
}

browser.permissions?.onAdded?.addListener(() => { handlePermissionsChange().catch(() => {}); });
browser.permissions?.onRemoved?.addListener(() => { handlePermissionsChange().catch(() => {}); });

initialize();
