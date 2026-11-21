'use strict';

let _activeProxyConfig = null;
let _activeProxyInfo = null;
// 'direct' | 'system' | 'proxy', or 'unknown' until the state is restored from storage.
let _currentMode = 'unknown';
let _quickTestHandler = null;
let _quickTestConfig = null;
const _pendingAuth = new Set();

// Allow list routing is decided per tab, from the address of the page it shows: every
// request of an allowed tab (CDNs, APIs, other domains) goes through the proxy. The map is
// mirrored to storage.session so it survives the background being suspended.
const TAB_ROUTES_KEY = 'tabRoutes';
let _tabRoutes = new Map(); // tabId -> true (proxy) | false (direct)
let _tabRoutesSaveTimer = null;

// The background is an event page: Zen suspends it when idle and wakes it up for the
// listeners registered below. Until background.js has restored the connection state from
// storage, requests wait on this promise instead of being routed with an empty state.
let _engineReady = false;
let _resolveEngineReady;
const _engineReadyPromise = new Promise(resolve => { _resolveEngineReady = resolve; });

function markEngineReady() {
  _engineReady = true;
  _resolveEngineReady();
}

function toBase64(str) {
  return btoa(String.fromCharCode(...new TextEncoder().encode(str)));
}

function buildProxyInfo(config) {
  if (!config || !config.host) return { type: 'direct' };
  const protocol = (config.protocol || 'http').toLowerCase();
  const port = parseInt(config.port, 10);

  if (protocol === 'socks5' || protocol === 'socks') {
    return {
      type: 'socks',
      host: config.host,
      port: port,
      username: config.username || undefined,
      password: config.password || undefined,
      proxyDNS: true
    };
  }

  if (protocol === 'socks4') {
    return {
      type: 'socks4',
      host: config.host,
      port: port
    };
  }

  // HTTP or HTTPS proxy
  const info = {
    type: protocol === 'https' ? 'https' : 'http',
    host: config.host,
    port: port
  };
  if (config.username) {
    info.proxyAuthorizationHeader = `Basic ${toBase64(`${config.username}:${config.password || ''}`)}`;
  }
  return info;
}

// Same trick as ProxyScrape: a random subdomain (wildcard DNS on scrapegw.com) makes
// Firefox open a fresh connection to the gateway instead of reusing one pooled from
// the previous proxy session. Applied once per connect and once per quick test.
// The username (country/rotation/sticky params from the dashboard) is never touched.
function randomizeScrapegwHost(host) {
  if (!/(^|\.)rp\.scrapegw\.com$/i.test(String(host || ''))) return host;
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  let prefix = '';
  for (const b of bytes) prefix += chars[b % chars.length];
  return `${prefix}.extension.rp.scrapegw.com`;
}

function isStickySession(config) {
  return /-session-[^-]+/i.test(String(config?.username || ''));
}

// Host used for a new connection. Sticky sessions keep the plain gateway host so nothing
// on our side can make the gateway hand out another exit IP.
function pickConnectionHost(config) {
  return isStickySession(config) ? config.host : randomizeScrapegwHost(config.host);
}

async function setWebRtcProtection(enabled) {
  const setting = browser.privacy?.network?.webRTCIPHandlingPolicy;
  if (!setting) return;
  try {
    if (enabled) {
      await setting.set({ value: 'disable_non_proxied_udp' });
    } else {
      await setting.clear({});
    }
  } catch (err) {
    console.warn('[ZenProxy] WebRTC policy update failed:', err?.message || err);
  }
}

function hostOf(urlStr) {
  try {
    return new URL(urlStr).hostname.toLowerCase();
  } catch (_) {
    return '';
  }
}

// "chatgpt.com" (or "*.chatgpt.com", ".chatgpt.com", a pasted URL) matches the domain and its subdomains.
function hostInAllowList(hostname, allowList) {
  if (!hostname) return false;
  for (const entry of allowList) {
    let e = String(entry || '').trim().toLowerCase();
    if (!e) continue;
    e = e.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').split(/[/?#]/)[0].replace(/:\d+$/, '');
    e = e.replace(/^\*?\./, '');
    if (e && (hostname === e || hostname.endsWith(`.${e}`))) return true;
  }
  return false;
}

function scheduleTabRoutesSave() {
  if (_tabRoutesSaveTimer) return;
  _tabRoutesSaveTimer = setTimeout(() => {
    _tabRoutesSaveTimer = null;
    browser.storage.session?.set({ [TAB_ROUTES_KEY]: Object.fromEntries(_tabRoutes) }).catch(() => {});
  }, 200);
}

function setTabRoute(tabId, proxied) {
  if (tabId < 0 || _tabRoutes.get(tabId) === proxied) return;
  _tabRoutes.set(tabId, proxied);
  scheduleTabRoutesSave();
}

function clearTabRoutes() {
  if (!_tabRoutes.size) return;
  _tabRoutes = new Map();
  scheduleTabRoutesSave();
}

async function restoreTabRoutes() {
  try {
    const stored = (await browser.storage.session?.get(TAB_ROUTES_KEY))?.[TAB_ROUTES_KEY] || {};
    _tabRoutes = new Map(Object.entries(stored).map(([id, v]) => [Number(id), v === true]));
  } catch (_) {
    _tabRoutes = new Map();
  }
}

// Whether a request belongs to a tab (or page) whose site is in the allow list.
function isAllowedByTab(requestInfo, allowList) {
  const { tabId = -1, type, url } = requestInfo;

  if (type === 'main_frame') {
    const allowed = hostInAllowList(hostOf(url), allowList);
    setTabRoute(tabId, allowed);
    return allowed;
  }
  if (tabId >= 0 && _tabRoutes.has(tabId)) return _tabRoutes.get(tabId);

  // Our own requests (exit IP check) always use the proxy, so the popup shows its IP.
  const origin = requestInfo.originUrl || '';
  if (tabId < 0 && origin.startsWith(browser.runtime.getURL(''))) return true;

  // Tab opened before the connection, or a request without a tab (service worker,
  // background sync): judge it on the top-level page, or on the page that sent it.
  const ancestors = requestInfo.frameAncestors;
  const topUrl = ancestors?.length ? ancestors[ancestors.length - 1].url
    : (requestInfo.documentUrl || origin);
  const allowed = hostInAllowList(hostOf(topUrl), allowList);
  if (tabId >= 0 && !ancestors?.length && requestInfo.frameId === 0) setTabRoute(tabId, allowed);
  return allowed;
}

function matchesBypass(urlStr, bypassList) {
  if (!bypassList || !bypassList.length) return false;
  let hostname = '';
  try {
    hostname = new URL(urlStr).hostname.toLowerCase();
  } catch (_) {
    return false;
  }
  for (const pattern of bypassList) {
    const p = String(pattern || '').trim().toLowerCase();
    if (!p) continue;
    if (p === hostname) return true;
    if (p.startsWith('*.')) {
      const suffix = p.slice(1); // e.g. '.google.com'
      if (hostname.endsWith(suffix) || hostname === p.slice(2)) return true;
    }
    if (p.startsWith('.') && hostname.endsWith(p)) return true;
  }
  return false;
}

// Only called for proxy authentication challenges (HTTP 407), see authRequiredListener.
function handleAuthRequired(details) {
  // Prevent infinite retry loops if credentials are rejected by proxy
  if (_pendingAuth.has(details.requestId)) {
    _pendingAuth.delete(details.requestId);
    return { cancel: true };
  }

  // 1. Check if this request is part of a quick-test
  if (_quickTestConfig && _quickTestConfig.username) {
    const isTestProbe = details.url.includes('cloudflare.com/cdn-cgi/trace') ||
                        details.url.includes('checkip.amazonaws.com');
    if (isTestProbe) {
      _pendingAuth.add(details.requestId);
      return {
        authCredentials: {
          username: _quickTestConfig.username,
          password: _quickTestConfig.password || ''
        }
      };
    }
  }

  // 2. Otherwise provide credentials of the active proxy
  if (_activeProxyConfig && _activeProxyConfig.username) {
    _pendingAuth.add(details.requestId);
    return {
      authCredentials: {
        username: _activeProxyConfig.username,
        password: _activeProxyConfig.password || ''
      }
    };
  }
}

// undefined = no decision: Firefox keeps the browser's own proxy settings (system mode,
// or the profile's kill switch when the state could not be restored).
function routeRequest(requestInfo) {
  if (_quickTestHandler) {
    const candidate = _quickTestHandler(requestInfo);
    if (candidate) return candidate;
  }

  if (_currentMode === 'direct') return { type: 'direct' };
  if (_currentMode !== 'proxy' || !_activeProxyInfo) return undefined;

  if (_activeProxyConfig && matchesBypass(requestInfo.url, _activeProxyConfig.bypassList)) {
    return { type: 'direct' };
  }
  const allowList = _activeProxyConfig?.allowList;
  if (allowList?.length && !isAllowedByTab(requestInfo, allowList)) {
    return { type: 'direct' };
  }
  return _activeProxyInfo;
}

function proxyRequestListener(requestInfo) {
  if (!_engineReady) return _engineReadyPromise.then(() => routeRequest(requestInfo));
  return routeRequest(requestInfo);
}

function authRequiredListener(details) {
  if (!details.isProxy) return;
  if (!_engineReady) return _engineReadyPromise.then(() => handleAuthRequired(details));
  return handleAuthRequired(details);
}

function reregisterProxyListener() {
  if (typeof browser === 'undefined' || !browser.proxy?.onRequest) return;
  if (browser.proxy.onRequest.hasListener(proxyRequestListener)) {
    browser.proxy.onRequest.removeListener(proxyRequestListener);
  }
  browser.proxy.onRequest.addListener(proxyRequestListener, { urls: ['<all_urls>'] });
}

// Registered synchronously at the top level, so Zen records them as persistent listeners
// and wakes the suspended background up for them (a listener added later, after an
// await, is not recorded: requests then bypass the extension while it sleeps).
if (typeof browser !== 'undefined') {
  browser.proxy?.onRequest?.addListener(proxyRequestListener, { urls: ['<all_urls>'] });
  browser.webRequest?.onAuthRequired?.addListener(authRequiredListener, { urls: ['<all_urls>'] }, ['blocking']);
  browser.webRequest?.onCompleted?.addListener(
    (details) => { _pendingAuth.delete(details.requestId); },
    { urls: ['<all_urls>'] }
  );
  browser.webRequest?.onErrorOccurred?.addListener(
    (details) => { _pendingAuth.delete(details.requestId); },
    { urls: ['<all_urls>'] }
  );
  browser.tabs?.onRemoved?.addListener((tabId) => {
    if (_tabRoutes.delete(tabId)) scheduleTabRoutesSave();
  });
}

function applyDirectMode() {
  _currentMode = 'direct';
  _activeProxyConfig = null;
  _activeProxyInfo = null;
  _pendingAuth.clear();
  clearTabRoutes();
  setWebRtcProtection(false);
}

function applySystemMode() {
  _currentMode = 'system';
  _activeProxyConfig = null;
  _activeProxyInfo = null;
  _pendingAuth.clear();
  clearTabRoutes();
  setWebRtcProtection(false);
}

// `host` is the connection host picked at connect time (see pickConnectionHost) and kept
// in storage, so waking the background up reuses the same connection.
function applyProxyMode(config, host = config.host, { keepTabRoutes = false } = {}) {
  if (!keepTabRoutes) clearTabRoutes();
  _currentMode = 'proxy';
  _activeProxyConfig = { ...config, allowList: normalizeHostList(config.allowList) };
  _activeProxyInfo = buildProxyInfo({ ...config, host });
  _pendingAuth.clear();
  setWebRtcProtection(true);
}

function setQuickTestHandler(handler, config = null) {
  _quickTestHandler = handler;
  _quickTestConfig = config;
}

function clearQuickTestHandler() {
  _quickTestHandler = null;
  _quickTestConfig = null;
}

// Log errors if Firefox rejects ProxyInfo
if (typeof browser !== 'undefined' && browser.proxy?.onError) {
  browser.proxy.onError.addListener((error) => {
    console.error('[ZenProxy] browser.proxy.onError:', error?.message || error);
    setProxyState({ lastError: error?.message || String(error) });
  });
}
