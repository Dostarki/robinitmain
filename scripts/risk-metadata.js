const cache = new Map();
const inflight = new Map();
const validChains = new Set(['solana', 'ethereum', 'base', 'arbitrum', 'optimism', 'bsc', 'polygon']);
const assetKey = (chain, address) => chain + ':' + (chain === 'solana' ? address : address.toLowerCase());

async function tokenIcons(chain, addresses) {
  if (!validChains.has(chain)) throw Error('Unsupported network');
  const missing = addresses.filter(address => (cache.get(assetKey(chain, address))?.expires || 0) < Date.now());
  if (missing.length) {
    const requestKey = chain + ':' + [...missing].sort().join(',');
    if (!inflight.has(requestKey)) {
      const request = (async () => {
        const response = await fetch('https://api.dexscreener.com/tokens/v1/' + chain + '/' + missing.map(encodeURIComponent).join(','), { signal: AbortSignal.timeout(6500) });
        if (!response.ok) throw Error('Token metadata unavailable');
        const pairs = await response.json();
        if (!Array.isArray(pairs)) throw Error('Unexpected metadata response');
        for (const address of missing) {
          const match = pairs.filter(pair => assetKey(chain, pair.baseToken?.address || '') === assetKey(chain, address)).sort((a, b) => Number(b.liquidity?.usd || 0) - Number(a.liquidity?.usd || 0));
          const pair = match.find(item => item.info?.imageUrl);
          let logo = null;
          try {
            const url = new URL(pair?.info?.imageUrl);
            if (url.protocol === 'https:' && (url.hostname === 'dexscreener.com' || url.hostname.endsWith('.dexscreener.com'))) logo = url.href;
          } catch {}
          cache.set(assetKey(chain, address), { logo, expires: Date.now() + (logo ? 1800000 : 300000) });
        }
        while (cache.size > 1000) cache.delete(cache.keys().next().value);
      })().finally(() => inflight.delete(requestKey));
      inflight.set(requestKey, request);
    }
    await inflight.get(requestKey);
  }
  return Object.fromEntries(addresses.map(address => [address, cache.get(assetKey(chain, address))?.logo || null]));
}
async function fetchTokenMarketData(chain, address, fetcher = fetch) {
  if (!validChains.has(chain)) return null;
  const key = 'market:' + assetKey(chain, address);
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) return cached.value;

  try {
    const response = await fetcher('https://api.dexscreener.com/tokens/v1/' + chain + '/' + encodeURIComponent(address), {
      signal: AbortSignal.timeout(120000),
      headers: { 'User-Agent': 'Robinity-Risk/1.0' }
    });
    if (!response.ok) return null;
    const pairs = await response.json();
    if (!Array.isArray(pairs) || !pairs.length) return null;

    const sorted = pairs
      .filter(pair => assetKey(chain, pair.baseToken?.address || '') === assetKey(chain, address))
      .sort((a, b) => Number(b.liquidity?.usd || 0) - Number(a.liquidity?.usd || 0));

    const best = sorted[0] || pairs[0];
    let logo = null;
    try {
      const url = new URL(best.info?.imageUrl);
      if (url.protocol === 'https:' && (url.hostname === 'dexscreener.com' || url.hostname.endsWith('.dexscreener.com'))) {
        logo = url.href;
      }
    } catch {}

    if (logo) {
      cache.set(assetKey(chain, address), { logo, expires: Date.now() + 1800000 });
    }

    const marketCapUsd = Number(best.marketCap || best.fdv || 0) || null;
    const result = {
      logo,
      marketCapUsd,
      fdvUsd: Number(best.fdv || 0) || null,
      priceUsd: Number(best.priceUsd || 0) || null,
      name: best.baseToken?.name || null,
      symbol: best.baseToken?.symbol || null,
      dexId: best.dexId || null,
      pairAddress: best.pairAddress || null
    };
    cache.set(key, { value: result, expires: Date.now() + 600000 });
    while (cache.size > 1000) cache.delete(cache.keys().next().value);
    return result;
  } catch {
    return null;
  }
}

module.exports = { tokenIcons, fetchTokenMarketData };
