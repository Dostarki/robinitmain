/**
 * Queue System Entry Point — Tüm bileşenleri başlatır
 * ANALYSIS_QUEUE_CACHE_IMPLEMENTATION_PLAN — Tam sistem entegrasyonu
 *
 * Bu modül serve-app.js'ten import edilir ve queue altyapısını
 * tek bir noktadan yönetir.
 */

const { closeAll: closeRedis } = require('./redis-client');
const { shutdownAll: shutdownQueues } = require('./queue-factory');
const { AnalysisOrchestrator } = require('./orchestrator');
const { createOrchestratorWorker, createFinalizerWorker, createProviderWorker } = require('./workers');
const { rateLimiter } = require('./rate-limiter');
const { getCacheStats } = require('./cache-adapter');
const { getAllQueueStats } = require('./queue-factory');
const { getMetricsSummary } = require('./job-repository');
const config = require('./config');

let initialized = false;
let orchestrator = null;

/**
 * Queue sistemini başlatır.
 * @param {object} opts
 * @param {Function} opts.hashSalt - Privacy hash salt sağlayıcı
 * @param {object} opts.riskAccess - RiskAccess instance
 * @param {object} opts.keyPool - KeyPool instance
 * @param {object} opts.upstreamFunctions - Provider-specific upstream çağrı fonksiyonları
 */
function initialize({ hashSalt, riskAccess, keyPool, upstreamFunctions = {} }) {
  if (initialized) {
    console.warn('[QueueSystem] Already initialized');
    return orchestrator;
  }

  const required = Object.keys(config.PROVIDER_LIMITS);
  if (required.some(name => typeof upstreamFunctions[name] !== 'function')) {
    throw new Error('Queue provider adapters are not configured');
  }
  console.log('[QueueSystem] Initializing...');

  // 1. Orchestrator oluştur
  orchestrator = new AnalysisOrchestrator({ hashSalt, riskAccess });

  // 2. Orchestrator worker'ı başlat
  createOrchestratorWorker({ keyPool, riskAccess });

  // 3. Finalizer worker'ı başlat
  createFinalizerWorker();

  // 4. Provider worker'ları başlat (upstream fonksiyonlar geçilirse)
  if (upstreamFunctions['goplus-security']) {
    createProviderWorker('goplus-security', upstreamFunctions['goplus-security']);
  }
  if (upstreamFunctions['helius-das']) {
    createProviderWorker('helius-das', upstreamFunctions['helius-das']);
  }
  if (upstreamFunctions['helius-wallet']) {
    createProviderWorker('helius-wallet', upstreamFunctions['helius-wallet']);
  }
  if (upstreamFunctions['bitquery-graphql']) {
    createProviderWorker('bitquery-graphql', upstreamFunctions['bitquery-graphql']);
  }
  if (upstreamFunctions['etherscan-read']) {
    createProviderWorker('etherscan-read', upstreamFunctions['etherscan-read']);
  }

  initialized = true;
  console.log('[QueueSystem] Initialized successfully');

  return orchestrator;
}

/**
 * Graceful shutdown — SIGTERM/SIGINT handler'ları.
 */
async function shutdown() {
  console.log('[QueueSystem] Graceful shutdown starting...');

  try {
    await shutdownQueues();
    await closeRedis();
    console.log('[QueueSystem] Shutdown complete');
  } catch (err) {
    console.error('[QueueSystem] Shutdown error:', err.message);
  }
}

/**
 * Admin panel için: Tam operasyonel snapshot (Bölüm 11).
 */
async function operationalSnapshot() {
  const [queueStats, rateLimitState, cacheStats, metrics5m, metrics15m, metrics60m] = await Promise.all([
    getAllQueueStats(),
    rateLimiter.snapshot(),
    getCacheStats(),
    getMetricsSummary(5),
    getMetricsSummary(15),
    getMetricsSummary(60),
  ]);

  return {
    queues: queueStats,
    rateLimits: rateLimitState,
    cache: cacheStats,
    metrics: {
      last5min: metrics5m,
      last15min: metrics15m,
      last60min: metrics60m,
    },
    config: {
      providerLimits: config.PROVIDER_LIMITS,
      userLimits: config.USER_LIMITS,
      retryPolicy: config.RETRY_POLICY,
      alertThresholds: config.ALERT_THRESHOLDS,
    },
    timestamp: Date.now(),
  };
}

// Process signal handler'ları
if (typeof process !== 'undefined') {
  const signals = ['SIGTERM', 'SIGINT'];
  for (const signal of signals) {
    process.on(signal, async () => {
      console.log(`[QueueSystem] Received ${signal}`);
      await shutdown();
      process.exit(0);
    });
  }
}

module.exports = {
  initialize,
  shutdown,
  operationalSnapshot,
  getOrchestrator: () => orchestrator,
  config,
};
