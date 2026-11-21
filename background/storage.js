'use strict';

const DEFAULT_BYPASS = ['localhost', '127.0.0.1', '[::1]'];
const DEFAULT_COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#6366F1', '#14B8A6'];
const BACKUP_FORMAT = 'zen-proxy-manager-backup';
const BACKUP_VERSION = 1;

function generateId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

function normalizeProtocol(proto) {
  const p = String(proto || 'http').toLowerCase().trim();
  if (p === 'socks' || p === 'socks5') return 'socks5';
  if (p === 'socks4') return 'socks4';
  if (p === 'https') return 'https';
  return 'http';
}

// One entry per line or comma; entries are kept as typed, matching is done in proxy-engine.js.
function normalizeHostList(value) {
  if (Array.isArray(value)) return value.map(s => String(s || '').trim()).filter(Boolean);
  if (typeof value === 'string') return value.split(/[\r\n,]+/).map(s => s.trim()).filter(Boolean);
  return [];
}

function makeProfile(data = {}) {
  const protocol = normalizeProtocol(data.protocol);
  const host = String(data.host || '').trim();
  const port = parseInt(data.port, 10) || 8080;
  const name = String(data.name || `${protocol.toUpperCase()} ${host}:${port}`).trim();
  const color = data.color || DEFAULT_COLORS[Math.floor(Math.random() * DEFAULT_COLORS.length)];

  let bypass = data.bypassList;
  if (!Array.isArray(bypass)) {
    if (typeof bypass === 'string') {
      bypass = bypass.split(/[\r\n,]+/).map(s => s.trim()).filter(Boolean);
    } else {
      bypass = [...DEFAULT_BYPASS];
    }
  }

  return {
    id: data.id || generateId(),
    name,
    color,
    protocol,
    host,
    port,
    username: data.username ? String(data.username).trim() : null,
    password: data.password ? String(data.password) : null,
    bypassList: bypass.length ? bypass : [...DEFAULT_BYPASS],
    // Empty: the proxy is used for every site. Otherwise only for tabs showing one of these sites.
    allowList: normalizeHostList(data.allowList),
    groupId: data.groupId || null,
    createdAt: data.createdAt || Date.now()
  };
}

function makeGroup(name, color = null) {
  return {
    id: generateId(),
    name: String(name || 'Group').trim(),
    color: color || DEFAULT_COLORS[Math.floor(Math.random() * DEFAULT_COLORS.length)],
    createdAt: Date.now()
  };
}

async function loadProfiles() {
  const res = await browser.storage.local.get({ profiles: [] });
  return Array.isArray(res.profiles) ? res.profiles : [];
}

async function saveProfiles(profiles) {
  await browser.storage.local.set({ profiles: Array.isArray(profiles) ? profiles : [] });
}

async function loadGroups() {
  const res = await browser.storage.local.get({ groups: [] });
  return Array.isArray(res.groups) ? res.groups : [];
}

async function saveGroups(groups) {
  await browser.storage.local.set({ groups: Array.isArray(groups) ? groups : [] });
}

async function getProxyState() {
  const res = await browser.storage.local.get({
    activeMode: 'direct',
    activeProfileId: null,
    activeProxy: null,
    activeProxyHost: null,
    detectedIp: null,
    detectedGeo: null,
    latencyMs: null,
    ipCheckFailed: false,
    lastError: null
  });
  return res;
}

async function setProxyState(updates) {
  await browser.storage.local.set(updates);
}
