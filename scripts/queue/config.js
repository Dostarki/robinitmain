/**
 * Merkezi Queue, Rate-Limit, Retry ve Cache TTL Konfigürasyonu
 * ANALYSIS_QUEUE_CACHE_IMPLEMENTATION_PLAN — Bölüm 5, 6, 7
 *
 * Bu dosya kod içine gömülmemesi gereken tüm sabitleri barındırır.
 * Admin yalnızca owner yetkisiyle değiştirir ve audit log oluşur.
 */

// ─── Queue tanımları (Bölüm 5) ──────────────────────────────────────────────
const QUEUES = {
  'analysis-orchestrator': {
    priority: 1, // En yüksek (1 = yüksek, 5 = düşük)
    description: 'Analiz aşamalarını planlar, alt işleri başlatır',
  },
  'goplus-security': {
    priority: 1,
    description: 'Temel token güvenlik verisi',
  },
  'helius-das': {
    priority: 3,
    description: 'Solana asset/mint/metadata sorgusu',
  },
  'helius-wallet': {
    priority: 4,
    description: 'Holdings, history ve snapshot işleri',
  },
  'bitquery-graphql': {
    priority: 3,
    description: 'Pump create signer, launch ve DEX verisi',
  },
  'etherscan-read': {
    priority: 3,
    description: 'EVM creation ve creator geçmişi',
  },
  'analysis-finalizer': {
    priority: 1,
    description: 'Parçaları birleştirip report snapshot kaydeder',
  },
};

// ─── Retry kuralları (Bölüm 5) ──────────────────────────────────────────────
const RETRY_POLICY = {
  maxAttempts: 3,
  initialBackoffMs: 2000,
  backoffType: 'exponential', // exponential with jitter
  // Sadece bu HTTP status kodları tekrar denenir
  retryableStatuses: [429, 500, 502, 503, 504],
  // Bu status kodları ASLA tekrar denenmez
  nonRetryableStatuses: [400, 401, 403],
  // Tamamlanan/failed işlerin saklanma süresi (ms)
  completedRetentionMs: 7 * 24 * 60 * 60 * 1000,  // 7 gün
  failedRetentionMs: 30 * 24 * 60 * 60 * 1000,     // 30 gün
};

// ─── Provider rate-limit başlangıç değerleri (Bölüm 6) ──────────────────────
const PROVIDER_LIMITS = {
  'goplus-security': {
    provider: 'GoPlus',
    endpointClass: 'token-security',
    throughput: 20,         // RPM
    throughputUnit: 'minute',
    concurrency: 2,
    burstCapacity: 4,       // Kısa burst kapasitesi
    refillRate: 0.333,      // token/saniye (20/60)
    cooldownMs: 60000,      // 429 sonrası bekleme süresi
  },
  'helius-das': {
    provider: 'Helius',
    endpointClass: 'das',
    throughput: 1,           // RPS
    throughputUnit: 'second',
    concurrency: 1,
    burstCapacity: 2,
    refillRate: 1,
    cooldownMs: 30000,
  },
  'helius-wallet': {
    provider: 'Helius',
    endpointClass: 'wallet-rpc',
    throughput: 6,           // RPS
    throughputUnit: 'second',
    concurrency: 4,
    burstCapacity: 8,
    refillRate: 6,
    cooldownMs: 30000,
  },
  'bitquery-graphql': {
    provider: 'Bitquery',
    endpointClass: 'graphql',
    throughput: 6,           // RPM
    throughputUnit: 'minute',
    concurrency: 1,
    burstCapacity: 2,
    refillRate: 0.1,         // token/saniye (6/60)
    cooldownMs: 120000,
  },
  'etherscan-read': {
    provider: 'Etherscan',
    endpointClass: 'read',
    throughput: 2,           // RPS
    throughputUnit: 'second',
    concurrency: 2,
    burstCapacity: 3,
    refillRate: 2,
    cooldownMs: 30000,
  },
};

// ─── Cache TTL matrisi (Bölüm 7) ────────────────────────────────────────────
// freshMs: Normal TTL, staleMs: stale-while-revalidate uzantısı
const CACHE_TTL = {
  'token-metadata': {
    label: 'Token name, symbol, logo, decimals',
    freshMs: 30 * 24 * 60 * 60 * 1000,    // 30 gün
    staleMs: 180 * 24 * 60 * 60 * 1000,   // 180 gün
  },
  'evm-creation': {
    label: 'EVM creation tx ve deployer',
    freshMs: 180 * 24 * 60 * 60 * 1000,   // 180 gün
    staleMs: Infinity,                      // Süresiz
  },
  'pump-create-signer': {
    label: 'Doğrulanmış Pump.fun create signer',
    freshMs: 180 * 24 * 60 * 60 * 1000,
    staleMs: Infinity,
  },
  'creator-launch-history': {
    label: 'Creator Pump launch geçmişi',
    freshMs: 24 * 60 * 60 * 1000,          // 24 saat
    staleMs: 30 * 24 * 60 * 60 * 1000,     // 30 gün
  },
  'contract-permissions': {
    label: 'Contract permissions / authority',
    freshMs: 60 * 60 * 1000,               // 1 saat
    staleMs: 24 * 60 * 60 * 1000,          // 24 saat
  },
  'goplus-security-signals': {
    label: 'GoPlus security signals',
    freshMs: 5 * 60 * 1000,                // 5 dakika
    staleMs: 24 * 60 * 60 * 1000,          // Historical display only
  },
  'honeypot-sellability': {
    label: 'Honeypot / sellability',
    freshMs: 2 * 60 * 1000,                // 2 dk
    staleMs: 2 * 60 * 60 * 1000,           // 2 saat
  },
  'market-data': {
    label: 'Market cap, fiyat, likidite',
    freshMs: 5 * 60 * 1000,                // 5 dk
    staleMs: 30 * 60 * 1000,               // 30 dk
  },
  'wallet-holdings': {
    label: 'Wallet holdings',
    freshMs: 15 * 60 * 1000,               // 15 dk
    staleMs: 2 * 60 * 60 * 1000,           // 2 saat
  },
  'wallet-history': {
    label: 'Wallet history',
    freshMs: 30 * 60 * 1000,               // 30 dk
    staleMs: 12 * 60 * 60 * 1000,          // 12 saat
  },
  'balance-snapshot': {
    label: 'Historical balance snapshot',
    freshMs: 24 * 60 * 60 * 1000,          // 24 saat
    staleMs: 30 * 24 * 60 * 60 * 1000,     // 30 gün
  },
  'full-report': {
    label: 'Tam report',
    freshMs: 15 * 60 * 1000,               // 15 dk
    staleMs: 24 * 60 * 60 * 1000,          // 24 saat
  },
};

// ─── Job durumları (Bölüm 4) ────────────────────────────────────────────────
const JOB_STATES = {
  QUEUED: 'queued',
  RUNNING: 'running',
  PARTIAL: 'partial',
  RETRYING: 'retrying',
  COMPLETED: 'completed',
  COMPLETED_WITH_GAPS: 'completed_with_gaps',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
};

// ─── Kullanıcı limitleri (Bölüm 4, madde 7) ─────────────────────────────────
const USER_LIMITS = {
  maxActiveJobs: 1,
  maxQueuedJobs: 2,
  reservationTimeoutMs: 5 * 60 * 1000,  // 5 dk
  quotaWindowMs: 60 * 60 * 1000,        // 1 saat
  quotaLimit: 3,                          // Saatlik analiz limiti
};

// ─── SSE aşamaları (Bölüm 9) ────────────────────────────────────────────────
const SSE_STAGES = [
  'queued',
  'security',
  'verification',
  'creator',
  'wallet',
  'finalizing',
  'completed',
];

// ─── Alarm eşikleri (Bölüm 11) ──────────────────────────────────────────────
const ALERT_THRESHOLDS = {
  provider429RatePercent: 2,       // 5 dakikada %2 üstü
  errorRatePercent: 10,            // Hata oranı %10 üstü
  queueP95WaitMs: 60000,          // 60 saniye
  keyUsageWarningPercent: 80,      // Key limiti %80
  keyUsageCriticalPercent: 95,     // Key limiti %95
  bitqueryExpiryWarningDays: [14, 7, 3, 1],
};

// ─── Analiz versiyonu ────────────────────────────────────────────────────────
const ANALYSIS_VERSION = 'v2';

module.exports = {
  QUEUES,
  RETRY_POLICY,
  PROVIDER_LIMITS,
  CACHE_TTL,
  JOB_STATES,
  USER_LIMITS,
  SSE_STAGES,
  ALERT_THRESHOLDS,
  ANALYSIS_VERSION,
};
