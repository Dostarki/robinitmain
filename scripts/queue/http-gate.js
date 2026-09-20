const { setTimeout: delay } = require('node:timers/promises');
const { rateLimiter } = require('./rate-limiter');
const { PROVIDER_LIMITS } = require('./config');

for (const [name, rpm] of Object.entries({ rugcheck: 10, honeypot: 10, dexscreener: 30 })) {
  PROVIDER_LIMITS[name] ||= { provider: name, endpointClass: 'public', concurrency: 2, burstCapacity: 2, refillRate: rpm / 60, cooldownMs: 60000 };
}
function providerFor(url, body) {
  const host = new URL(url).hostname;
  if (host === 'api.gopluslabs.io') return 'goplus-security';
  if (host === 'api.rugcheck.xyz') return 'rugcheck';
  if (host === 'api.honeypot.is') return 'honeypot';
  if (host === 'api.dexscreener.com') return 'dexscreener';
  if (host.endsWith('.helius-rpc.com') || host.endsWith('.helius.xyz')) {
    return /getAsset|searchAssets/.test(String(body || '')) ? 'helius-das' : 'helius-wallet';
  }
  if (host.endsWith('.bitquery.io')) return 'bitquery-graphql';
  if (host === 'api.etherscan.io') return 'etherscan-read';
  throw Error('Unsupported analysis provider');
}
function createGatedFetch({ fetcher = fetch, limiter = rateLimiter } = {}) {
  return async (url, options = {}) => {
    const provider = providerFor(url, options.body);
    const deadline = Date.now() + 120000;
    let permit;
    do {
      options.signal?.throwIfAborted();
      permit = await limiter.acquire(provider); // Redis failure is fail-closed.
      if (permit.allowed) break;
      if (Date.now() >= deadline) throw Error('Provider queue deadline exceeded');
      await delay(Math.min(5000, Math.max(100, permit.retryAfterMs)), undefined, { signal: options.signal });
    } while (true);
    try {
      const timeoutSignal = options.signal || AbortSignal.timeout(options.timeoutMs || 30000);
      const response = await fetcher(url, { ...options, redirect: 'error', signal: timeoutSignal });
      // Consume the body under the lease; callers receive a buffered Response.
      const body = await response.arrayBuffer();
      if (response.status === 429) {
        const raw = response.headers.get('retry-after');
        const milliseconds = raw && Number.isFinite(Number(raw)) ? Number(raw) * 1000 : Math.max(0, Date.parse(raw) - Date.now()) || 0;
        await limiter.setCooldown(provider, undefined, milliseconds);
      }
      return new Response(body.byteLength ? body : null, { status: response.status, statusText: response.statusText, headers: response.headers });
    } finally { await limiter.release(provider, permit.leaseId); }
  };
}
module.exports = { createGatedFetch, providerFor };
