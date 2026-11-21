'use strict';

// Plain HTTP first: through an HTTP proxy it is a single request, whereas HTTPS needs a
// CONNECT tunnel plus a TLS handshake through the (slow) residential exit.
const TEST_TARGET_CLOUDFLARE_HTTP = 'http://cloudflare.com/cdn-cgi/trace';
const TEST_TARGET_CLOUDFLARE = 'https://cloudflare.com/cdn-cgi/trace';
const TEST_TARGET_AWS = 'http://checkip.amazonaws.com';
const PROBE_TIMEOUT_MS = 10000;

function parseCloudflareTrace(text) {
  let ip = null;
  let loc = null;
  const lines = text.split('\n');
  for (const line of lines) {
    if (line.startsWith('ip=')) ip = line.substring(3).trim();
    if (line.startsWith('loc=')) loc = line.substring(4).trim();
  }
  return { ip, countryCode: loc };
}

// latencyMs = time for one full request through the active route (includes the
// proxy handshake on a fresh connection), measured on the probe that succeeded.
async function detectCurrentExitIp() {
  for (const target of [TEST_TARGET_CLOUDFLARE_HTTP, TEST_TARGET_CLOUDFLARE]) {
    try {
      const startedAt = performance.now();
      const res = await fetch(`${target}?_=${Date.now()}`, {
        cache: 'no-store',
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS)
      });
      if (res.ok) {
        const text = await res.text();
        const parsed = parseCloudflareTrace(text);
        if (parsed.ip) return { ...parsed, latencyMs: Math.round(performance.now() - startedAt) };
      }
    } catch (_) {}
  }

  // Last resort: AWS plain text IP (no country, so no flag)
  try {
    const startedAt = performance.now();
    const res = await fetch(`${TEST_TARGET_AWS}?_=${Date.now()}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS)
    });
    if (res.ok) {
      const text = (await res.text()).trim();
      if (/^[\d.a-fA-F:]+$/.test(text)) {
        return { ip: text, countryCode: null, latencyMs: Math.round(performance.now() - startedAt) };
      }
    }
  } catch (_) {}

  return null;
}

async function runProxyTest(config) {
  const startedAt = performance.now();
  const testProxyInfo = buildProxyInfo({ ...config, host: randomizeScrapegwHost(config.host) });

  // Set hook in proxy-engine to route only test requests through this proxy
  setQuickTestHandler((requestInfo) => {
    if (
      requestInfo.url.includes('cloudflare.com/cdn-cgi/trace') ||
      requestInfo.url.includes('checkip.amazonaws.com')
    ) {
      return testProxyInfo;
    }
    return null;
  }, config);

  try {
    const res = await fetch(`${TEST_TARGET_CLOUDFLARE_HTTP}?_=${Date.now()}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS)
    });
    const latencyMs = Math.round(performance.now() - startedAt);

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const text = await res.text();
    const { ip, countryCode } = parseCloudflareTrace(text);
    if (!ip) throw new Error('No IP returned by judge');

    return {
      ok: true,
      ip,
      countryCode,
      latencyMs
    };
  } catch (err) {
    const latencyMs = Math.round(performance.now() - startedAt);
    return {
      ok: false,
      error: err.name === 'TimeoutError' ? `Timeout (${PROBE_TIMEOUT_MS / 1000}s)` : (err.message || 'Connection failed'),
      latencyMs
    };
  } finally {
    clearQuickTestHandler();
  }
}
