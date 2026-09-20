/**
 * Job Repository — Job Lifecycle ve Report Persistence
 * ANALYSIS_QUEUE_CACHE_IMPLEMENTATION_PLAN — Bölüm 4, 8
 *
 * PostgreSQL tabloları planlanmış ama şu an JSON dosya tabanlı
 * kalıcılık kullanılıyor. Arayüz PostgreSQL migrasyonuna hazır.
 *
 * Tabloları: analysis_jobs, analysis_reports, analysis_watchers
 * Wallet ve IP ham halde saklanmaz; HMAC özetleri saklanır (Bölüm 8).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const jobEvents = new EventEmitter();
const { JOB_STATES, ANALYSIS_VERSION } = require('./config');

const DATA_DIR = process.env.QUEUE_DATA_DIR || path.join(__dirname, '..', '..', 'data');
const JOBS_PATH = path.join(DATA_DIR, 'analysis-jobs.json');
const REPORTS_PATH = path.join(DATA_DIR, 'analysis-reports.json');
const WATCHERS_PATH = path.join(DATA_DIR, 'analysis-watchers.json');
const AUDIT_PATH = path.join(DATA_DIR, 'admin-audit-events.json');

function ensureDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJSON(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJSON(filePath, data) {
  ensureDir();
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, filePath);
}

// ─── Analysis Jobs ──────────────────────────────────────────────────────────

function loadJobs() {
  return readJSON(JOBS_PATH, { jobs: [] });
}

function saveJobs(store) {
  writeJSON(JOBS_PATH, store);
}

/**
 * Yeni job oluşturur.
 * @param {object} params
 * @param {string} params.assetKey - chain:canonicalAddress
 * @param {string} params.chain
 * @param {string} params.address - Canonical adres
 * @param {string} params.ownerWalletHash - HMAC wallet hash
 * @param {string} params.ownerIpHash - HMAC IP hash
 * @returns {object} Oluşturulan job
 */
function createJob({ assetKey, chain, address, ownerWalletHash, ownerIpHash }) {
  const store = loadJobs();
  const now = Date.now();
  const job = {
    id: crypto.randomUUID(),
    assetKey,
    chain,
    address,
    ownerWalletHash,
    ownerIpHash,
    status: JOB_STATES.QUEUED,
    analysisVersion: ANALYSIS_VERSION,
    stage: 'queued',
    progress: 0,
    errorCode: null,
    errorMessage: null,
    bullmqJobId: null,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    completedAt: null,
  };

  store.jobs.unshift(job);
  // En fazla 5000 job sakla
  store.jobs = store.jobs.slice(0, 5000);
  saveJobs(store);
  return job;
}

/**
 * Job durumunu günceller.
 */
function updateJob(jobId, updates) {
  const store = loadJobs();
  const job = store.jobs.find(j => j.id === jobId);
  if (!job) return null;

  Object.assign(job, updates, { updatedAt: Date.now() });
  saveJobs(store);
  jobEvents.emit('updated', job);
  return job;
}

/**
 * Job'u ID ile bulur.
 */
function findJob(jobId) {
  return loadJobs().jobs.find(j => j.id === jobId) || null;
}

/**
 * Asset key'e göre aktif (queued veya running) job bulur.
 * Deduplication için kullanılır (Bölüm 4, madde 4-5).
 */
function findActiveJobByAsset(assetKey) {
  const activeStates = [JOB_STATES.QUEUED, JOB_STATES.RUNNING, JOB_STATES.RETRYING, JOB_STATES.PARTIAL];
  return loadJobs().jobs.find(j => j.assetKey === assetKey && activeStates.includes(j.status)) || null;
}

/**
 * Kullanıcının aktif ve queued job sayısını döner.
 * Bölüm 4, madde 7: Kullanıcı başına maks 1 active + 2 queued.
 */
function countUserJobs(ownerWalletHash) {
  const jobs = loadJobs().jobs;
  let active = 0;
  let queued = 0;

  for (const job of jobs) {
    if (job.ownerWalletHash !== ownerWalletHash) continue;
    if (job.status === JOB_STATES.RUNNING || job.status === JOB_STATES.PARTIAL) active++;
    if (job.status === JOB_STATES.QUEUED) queued++;
  }

  return { active, queued };
}

/**
 * Queue pozisyonunu hesaplar.
 */
function queuePosition(jobId) {
  const jobs = loadJobs().jobs.filter(j => j.status === JOB_STATES.QUEUED);
  const index = jobs.findIndex(j => j.id === jobId);
  return index >= 0 ? index + 1 : 0;
}

// ─── Analysis Reports (Bölüm 8: analysis_reports) ──────────────────────────

function loadReports() {
  return readJSON(REPORTS_PATH, { reports: [] });
}

function saveReports(store) {
  writeJSON(REPORTS_PATH, store);
}

/**
 * Report snapshot kaydeder.
 */
function saveReport(report) {
  const store = loadReports();
  // Aynı assetKey + version varsa güncelle
  const idx = store.reports.findIndex(r =>
    r.assetKey === report.assetKey && r.version === report.version
  );

  const entry = {
    ...report,
    savedAt: Date.now(),
  };

  if (idx >= 0) {
    store.reports[idx] = entry;
  } else {
    store.reports.unshift(entry);
  }

  store.reports = store.reports.slice(0, 2000);
  saveReports(store);
  return entry;
}

/**
 * Asset key ile en güncel report'u döner.
 */
function findReport(assetKey, version) {
  const v = version || ANALYSIS_VERSION;
  return loadReports().reports.find(r => r.assetKey === assetKey && r.version === v) || null;
}

/**
 * Report freshness durumunu kontrol eder.
 * @returns {'fresh' | 'stale' | 'expired'}
 */
function checkFreshness(report, cacheTTL) {
  if (!report) return 'expired';
  const age = Date.now() - report.savedAt;
  if (age <= cacheTTL.freshMs) return 'fresh';
  if (age <= cacheTTL.freshMs + cacheTTL.staleMs) return 'stale';
  return 'expired';
}

// ─── Analysis Watchers (Bölüm 8: analysis_watchers) ────────────────────────

function loadWatchers() {
  return readJSON(WATCHERS_PATH, { watchers: [] });
}

function saveWatchers(store) {
  writeJSON(WATCHERS_PATH, store);
}

/**
 * Kullanıcıyı mevcut job'a watcher olarak ekler.
 * Aynı asset zaten çalışıyorsa kullanıcı watcher olur; yeni upstream job oluşmaz (Bölüm 4, madde 5).
 */
function addWatcher(jobId, walletHash) {
  const store = loadWatchers();
  const exists = store.watchers.find(w => w.jobId === jobId && w.walletHash === walletHash);
  if (exists) return exists;

  const watcher = {
    id: crypto.randomUUID(),
    jobId,
    walletHash,
    joinedAt: Date.now(),
  };

  store.watchers.push(watcher);
  store.watchers = store.watchers.slice(-10000);
  saveWatchers(store);
  return watcher;
}

/**
 * Job'a bağlı tüm watcher'ları döner.
 */
function getWatchers(jobId) {
  return loadWatchers().watchers.filter(w => w.jobId === jobId);
}

function canReadJob(jobId, walletHash) {
  if (!walletHash) return false;
  const job = findJob(jobId);
  return !!job && (job.ownerWalletHash === walletHash || getWatchers(jobId).some(w => w.walletHash === walletHash));
}

function historyForWallet(walletHash) {
  if (!walletHash) return [];
  const watched = new Set(loadWatchers().watchers.filter(w => w.walletHash === walletHash).map(w => w.jobId));
  const keys = new Set(loadJobs().jobs.filter(j => j.ownerWalletHash === walletHash || watched.has(j.id)).map(j => j.assetKey));
  return loadReports().reports.filter(r => keys.has(r.assetKey)).slice(0, 50);
}

// ─── Admin Audit Events (Bölüm 8: admin_audit_events) ──────────────────────

function loadAudit() {
  return readJSON(AUDIT_PATH, { events: [] });
}

function saveAudit(store) {
  writeJSON(AUDIT_PATH, store);
}

/**
 * Audit log kaydı oluşturur (Bölüm 12).
 */
function auditLog(actor, action, target, details = {}) {
  const store = loadAudit();
  store.events.unshift({
    id: crypto.randomUUID(),
    actor,
    action,
    target,
    details,
    timestamp: Date.now(),
  });
  store.events = store.events.slice(0, 10000);
  saveAudit(store);
}

// ─── Provider Request Metrics (Bölüm 8: provider_request_metrics) ──────────

const METRICS_PATH = path.join(DATA_DIR, 'provider-request-metrics.json');

function loadMetrics() {
  return readJSON(METRICS_PATH, { buckets: [] });
}

function saveMetrics(store) {
  writeJSON(METRICS_PATH, store);
}

/**
 * Provider isteği metriğini kaydeder.
 */
function recordProviderMetric({ provider, endpointClass, keyId, latencyMs, success, statusCode }) {
  const store = loadMetrics();
  const now = Date.now();
  const minuteBucket = new Date(now).toISOString().slice(0, 16); // YYYY-MM-DDTHH:MM

  let bucket = store.buckets.find(b =>
    b.provider === provider && b.endpointClass === endpointClass && b.minuteBucket === minuteBucket
  );

  if (!bucket) {
    bucket = {
      provider,
      endpointClass,
      minuteBucket,
      requests: 0,
      successes: 0,
      failures: 0,
      status429: 0,
      status5xx: 0,
      timeouts: 0,
      totalLatencyMs: 0,
      maxLatencyMs: 0,
    };
    store.buckets.unshift(bucket);
  }

  bucket.requests++;
  if (success) bucket.successes++;
  else bucket.failures++;
  if (statusCode === 429) bucket.status429++;
  if (statusCode >= 500) bucket.status5xx++;
  bucket.totalLatencyMs += latencyMs || 0;
  bucket.maxLatencyMs = Math.max(bucket.maxLatencyMs, latencyMs || 0);

  // Son 7 günlük bucket'ları tut
  const cutoff = now - 7 * 24 * 60 * 60 * 1000;
  store.buckets = store.buckets.filter(b => Date.parse(b.minuteBucket) > cutoff).slice(0, 50000);
  saveMetrics(store);

  return bucket;
}

/**
 * Admin panel için: Son N dakikadaki metrikleri özetle (Bölüm 11).
 */
function getMetricsSummary(minutes = 60) {
  const store = loadMetrics();
  const cutoff = new Date(Date.now() - minutes * 60 * 1000).toISOString().slice(0, 16);
  const recent = store.buckets.filter(b => b.minuteBucket >= cutoff);

  const summary = {};
  for (const bucket of recent) {
    const key = `${bucket.provider}:${bucket.endpointClass}`;
    if (!summary[key]) {
      summary[key] = {
        provider: bucket.provider,
        endpointClass: bucket.endpointClass,
        requests: 0, successes: 0, failures: 0,
        status429: 0, status5xx: 0, timeouts: 0,
        totalLatencyMs: 0, maxLatencyMs: 0,
      };
    }
    const s = summary[key];
    s.requests += bucket.requests;
    s.successes += bucket.successes;
    s.failures += bucket.failures;
    s.status429 += bucket.status429;
    s.status5xx += bucket.status5xx;
    s.timeouts += bucket.timeouts;
    s.totalLatencyMs += bucket.totalLatencyMs;
    s.maxLatencyMs = Math.max(s.maxLatencyMs, bucket.maxLatencyMs);
  }

  // avgLatencyMs ekle
  for (const s of Object.values(summary)) {
    s.avgLatencyMs = s.requests > 0 ? Math.round(s.totalLatencyMs / s.requests) : 0;
  }

  return summary;
}

module.exports = {
  jobEvents,
  // Jobs
  createJob,
  updateJob,
  findJob,
  findActiveJobByAsset,
  countUserJobs,
  queuePosition,

  // Reports
  saveReport,
  findReport,
  checkFreshness,

  // Watchers
  addWatcher,
  getWatchers,
  canReadJob,
  historyForWallet,

  // Audit
  auditLog,

  // Metrics
  recordProviderMetric,
  getMetricsSummary,
};
