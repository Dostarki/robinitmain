/**
 * Redis Cache Adapter — L2 Shared TTL Cache
 * ANALYSIS_QUEUE_CACHE_IMPLEMENTATION_PLAN — Bölüm 7
 *
 * Cache katmanları:
 *   L1: Worker process memory, 30–60 saniye (in-process Map)
 *   L2: Redis shared TTL cache, active-job lock ve stale refresh deduplication
 *   L3: Job repository (JSON/PostgreSQL) immutable snapshot
 *
 * Versioned key formatı: analysis:v2:{chain}:{address}
 */

const { getCacheConnection } = require('./redis-client');
const { CACHE_TTL, ANALYSIS_VERSION } = require('./config');

const L1_TTL_MS = 30000; // 30 saniye
const l1Cache = new Map();
const L1_MAX_SIZE = 500;

/**
 * Versioned cache key oluşturur.
 * @param {string} type - Cache tipi (CACHE_TTL key'i)
 * @param {string} chain
 * @param {string} address
 * @returns {string}
 */
function cacheKey(type, chain, address) {
  return `cache:${ANALYSIS_VERSION}:${type}:${chain}:${address}`;
}

/**
 * L1 process memory cache — okuma.
 */
function l1Get(key) {
  const entry = l1Cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expires) {
    l1Cache.delete(key);
    return null;
  }
  return entry.value;
}

/**
 * L1 process memory cache — yazma.
 */
function l1Set(key, value) {
  l1Cache.set(key, { value, expires: Date.now() + L1_TTL_MS });
  // LRU eviction
  while (l1Cache.size > L1_MAX_SIZE) {
    l1Cache.delete(l1Cache.keys().next().value);
  }
}

/**
 * L2 Redis cache'ten okuma.
 * @param {string} type - CACHE_TTL key'i
 * @param {string} chain
 * @param {string} address
 * @returns {{ value: any, freshness: 'fresh'|'stale'|'expired', savedAt: number } | null}
 */
async function cacheGet(type, chain, address) {
  const key = cacheKey(type, chain, address);

  // L1 kontrol
  const l1 = l1Get(key);
  if (l1) {
    const ttl = CACHE_TTL[type];
    const age = Date.now() - l1.savedAt;
    return { ...l1, freshness: age <= ttl.freshMs ? 'fresh' : age <= ttl.freshMs + ttl.staleMs ? 'stale' : 'expired' };
  }

  // L2 Redis kontrol
  const redis = getCacheConnection();
  const raw = await redis.get(key);
  if (!raw) return null;

  try {
    const entry = JSON.parse(raw);
    const ttlConfig = CACHE_TTL[type];
    const age = Date.now() - entry.savedAt;

    let freshness;
    if (age <= ttlConfig.freshMs) {
      freshness = 'fresh';
    } else if (ttlConfig.staleMs === Infinity || age <= ttlConfig.freshMs + ttlConfig.staleMs) {
      freshness = 'stale';
    } else {
      freshness = 'expired';
    }

    const result = { value: entry.value, freshness, savedAt: entry.savedAt };

    // L1'e yaz
    l1Set(key, result);

    return result;
  } catch {
    return null;
  }
}

/**
 * L2 Redis cache'e yazma.
 * TTL: freshMs + staleMs (toplam süre Redis'te kalır; freshness uygulama katmanında kontrol edilir).
 */
async function cacheSet(type, chain, address, value) {
  const key = cacheKey(type, chain, address);
  const ttlConfig = CACHE_TTL[type];

  const entry = {
    value,
    savedAt: Date.now(),
    type,
    chain,
    address,
    version: ANALYSIS_VERSION,
  };

  const redis = getCacheConnection();

  // Toplam TTL hesapla (Redis'teki saklama süresi)
  let totalTtlMs;
  if (ttlConfig.staleMs === Infinity) {
    totalTtlMs = 365 * 24 * 60 * 60 * 1000; // Süresiz → 1 yıl
  } else {
    totalTtlMs = ttlConfig.freshMs + ttlConfig.staleMs;
  }

  const totalTtlSeconds = Math.ceil(totalTtlMs / 1000);

  await redis.set(key, JSON.stringify(entry), 'EX', totalTtlSeconds);

  // L1'e de yaz
  l1Set(key, { value, freshness: 'fresh', savedAt: entry.savedAt });
}

/**
 * Cache silme (owner refresh/invalidation — Bölüm 12).
 */
async function cacheDelete(type, chain, address) {
  const key = cacheKey(type, chain, address);
  l1Cache.delete(key);

  const redis = getCacheConnection();
  await redis.del(key);
}

/**
 * Asset için tüm cache tiplerini sil (tam invalidation).
 */
async function cacheInvalidateAsset(chain, address) {
  const suffix = `:${chain}:${address}`;
  for (const key of l1Cache.keys()) if (key.endsWith(suffix)) l1Cache.delete(key);
  const redis = getCacheConnection();
  const pattern = `cache:${ANALYSIS_VERSION}:*:${chain}:${address}`;

  // SCAN ile ilgili key'leri bul ve sil
  let cursor = '0';
  do {
    const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
    cursor = nextCursor;
    if (keys.length > 0) {
      await redis.del(...keys);
      for (const key of keys) l1Cache.delete(key);
    }
  } while (cursor !== '0');
}

/**
 * Stale-while-revalidate: Refresh deduplication lock.
 * Aynı asset için yalnızca bir refresh job arka planda oluşur (Bölüm 7).
 *
 * @returns {boolean} true = lock alındı, refresh yapılmalı; false = zaten refresh yapılıyor
 */
async function acquireRefreshLock(type, chain, address, ttlMs = 60000) {
  const redis = getCacheConnection();
  const lockKey = `refresh-lock:${ANALYSIS_VERSION}:${type}:${chain}:${address}`;
  const result = await redis.set(lockKey, Date.now().toString(), 'PX', ttlMs, 'NX');
  return result === 'OK';
}

/**
 * Refresh lock'u serbest bırak.
 */
async function releaseRefreshLock(type, chain, address) {
  const redis = getCacheConnection();
  const lockKey = `refresh-lock:${ANALYSIS_VERSION}:${type}:${chain}:${address}`;
  await redis.del(lockKey);
}

/**
 * Admin panel: Cache istatistikleri (hit/miss oranları).
 * Not: Bu basit bir sayaç tabanlı yaklaşım. Production'da Redis keyspace notifications kullanılabilir.
 */
const cacheStats = { hits: 0, staleHits: 0, misses: 0 };

function recordCacheHit(freshness) {
  if (freshness === 'fresh') cacheStats.hits++;
  else if (freshness === 'stale') cacheStats.staleHits++;
  else cacheStats.misses++;
}

function getCacheStats() {
  const total = cacheStats.hits + cacheStats.staleHits + cacheStats.misses;
  return {
    ...cacheStats,
    total,
    hitRate: total > 0 ? ((cacheStats.hits / total) * 100).toFixed(1) + '%' : '0%',
    staleRate: total > 0 ? ((cacheStats.staleHits / total) * 100).toFixed(1) + '%' : '0%',
    missRate: total > 0 ? ((cacheStats.misses / total) * 100).toFixed(1) + '%' : '0%',
  };
}

module.exports = {
  cacheKey,
  cacheGet,
  cacheSet,
  cacheDelete,
  cacheInvalidateAsset,
  acquireRefreshLock,
  releaseRefreshLock,
  recordCacheHit,
  getCacheStats,
  CACHE_TTL,
};
