/**
 * Redis Client Factory
 * ANALYSIS_QUEUE_CACHE_IMPLEMENTATION_PLAN — Bölüm 3, 12
 *
 * Redis bağlantı havuzu oluşturur. BullMQ, cache ve lock işlemleri
 * için ayrı connection'lar kullanılır.
 *
 * Güvenlik: Redis private network, TLS, ACL desteği (Bölüm 12).
 */

const IORedis = require('ioredis');

/** Varsayılan Redis ayarları */
const DEFAULTS = {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: Number(process.env.REDIS_PORT || 6379),
  password: process.env.REDIS_PASSWORD || undefined,
  db: Number(process.env.REDIS_DB || 0),
  maxRetriesPerRequest: null, // BullMQ gereksinimi
  enableReadyCheck: true,
  retryStrategy(times) {
    if (!process.env.DATABASE_URL && !process.env.REDIS_HOST && times > 1) return null;
    return Math.min(times * 200, 5000);
  },
  // TLS ayarları (production için)
  ...(process.env.REDIS_TLS === '1' ? { tls: { rejectUnauthorized: true } } : {}),
};

/** Aktif bağlantıları takip et */
const connections = new Map();

// serve-app loads .env after importing this module; read credentials at connection time.
function settings() {
  return {
    ...DEFAULTS,
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: Number(process.env.REDIS_PORT || 6379),
    password: process.env.REDIS_PASSWORD || undefined,
    username: process.env.REDIS_USERNAME || undefined,
    db: Number(process.env.REDIS_DB || 0),
    tls: process.env.REDIS_TLS === '1' ? { rejectUnauthorized: true } : undefined,
    retryStrategy(times) {
      if (!process.env.DATABASE_URL && !process.env.REDIS_HOST && times > 1) return null;
      return Math.min(times * 200, 5000);
    },
  };
}

/**
 * İsimlendirilmiş Redis bağlantısı oluşturur veya mevcut olanı döner.
 * @param {string} name - Bağlantı adı (ör: 'bullmq', 'cache', 'lock')
 * @param {object} overrides - Varsayılan ayarları geçersiz kılmak için
 * @returns {IORedis} Redis client instance
 */
function getConnection(name = 'default', overrides = {}) {
  if (connections.has(name)) {
    const existing = connections.get(name);
    if (existing.status !== 'end') {
      return existing;
    }
    // Bağlantı kopmuşsa temizle ve yeniden oluştur
    connections.delete(name);
  }

  const client = new IORedis({ ...settings(), maxRetriesPerRequest: 1, enableOfflineQueue: false, ...overrides });

  client.on('error', (err) => {
    // Log ama crash etme — Redis geçici olarak erişilemez olabilir
    console.error(`[Redis:${name}] Connection error:`, err.message);
  });

  client.on('ready', () => {
    console.log(`[Redis:${name}] Connected`);
  });

  client.on('close', () => {
    console.log(`[Redis:${name}] Connection closed`);
  });

  connections.set(name, client);
  return client;
}

/**
 * BullMQ queue'ları için özelleştirilmiş bağlantı oluşturur.
 * Her queue kendi connection'ına sahip olmalıdır (BullMQ gereksinimi).
 */
function createBullMQConnection(queueName) {
  return new IORedis({
    ...settings(),
    // BullMQ her queue için ayrı connection gerektirir
    lazyConnect: true,
  });
}

/**
 * Cache işlemleri için ayrı bağlantı.
 */
function getCacheConnection() {
  return getConnection('cache');
}

/**
 * Lock ve deduplication işlemleri için ayrı bağlantı.
 */
function getLockConnection() {
  return getConnection('lock');
}

/**
 * Tüm bağlantıları güvenli şekilde kapatır (graceful shutdown).
 */
async function closeAll() {
  const promises = [];
  for (const [name, client] of connections) {
    console.log(`[Redis:${name}] Closing...`);
    promises.push(client.quit().catch(() => client.disconnect()));
  }
  await Promise.allSettled(promises);
  connections.clear();
}

module.exports = {
  getConnection,
  createBullMQConnection,
  getCacheConnection,
  getLockConnection,
  closeAll,
  DEFAULTS,
};
