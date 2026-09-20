/**
 * Queue System Unit Tests — P1/P2 Module Validation
 * Config, Job Repository, Orchestrator temel testleri
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

// Test data directory
const TEST_DATA_DIR = path.join(__dirname, '..', '..', 'data');

console.log('═══════════════════════════════════════════════════');
console.log(' Queue System — Unit Tests');
console.log('═══════════════════════════════════════════════════\n');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${err.message}`);
  }
}

// ─── Config Tests ───────────────────────────────────────────────────────────
console.log('Config Module:');

const config = require('../queue/config');

test('exports all required constants', () => {
  assert.ok(config.QUEUES);
  assert.ok(config.RETRY_POLICY);
  assert.ok(config.PROVIDER_LIMITS);
  assert.ok(config.CACHE_TTL);
  assert.ok(config.JOB_STATES);
  assert.ok(config.USER_LIMITS);
  assert.ok(config.SSE_STAGES);
  assert.ok(config.ALERT_THRESHOLDS);
  assert.ok(config.ANALYSIS_VERSION);
});

test('defines all 7 queues from plan', () => {
  const expected = [
    'analysis-orchestrator', 'goplus-security', 'helius-das',
    'helius-wallet', 'bitquery-graphql', 'etherscan-read', 'analysis-finalizer'
  ];
  for (const name of expected) {
    assert.ok(config.QUEUES[name], `Missing queue: ${name}`);
  }
});

test('provider limits match plan specifications', () => {
  assert.strictEqual(config.PROVIDER_LIMITS['goplus-security'].throughput, 20);
  assert.strictEqual(config.PROVIDER_LIMITS['goplus-security'].throughputUnit, 'minute');
  assert.strictEqual(config.PROVIDER_LIMITS['helius-das'].throughput, 1);
  assert.strictEqual(config.PROVIDER_LIMITS['helius-das'].concurrency, 1);
  assert.strictEqual(config.PROVIDER_LIMITS['helius-wallet'].throughput, 6);
  assert.strictEqual(config.PROVIDER_LIMITS['helius-wallet'].concurrency, 4);
  assert.strictEqual(config.PROVIDER_LIMITS['bitquery-graphql'].throughput, 6);
  assert.strictEqual(config.PROVIDER_LIMITS['bitquery-graphql'].concurrency, 1);
  assert.strictEqual(config.PROVIDER_LIMITS['etherscan-read'].throughput, 2);
  assert.strictEqual(config.PROVIDER_LIMITS['etherscan-read'].concurrency, 2);
});

test('retry policy: 3 attempts, exponential backoff', () => {
  assert.strictEqual(config.RETRY_POLICY.maxAttempts, 3);
  assert.strictEqual(config.RETRY_POLICY.backoffType, 'exponential');
  assert.strictEqual(config.RETRY_POLICY.initialBackoffMs, 2000);
});

test('user limits: 1 active + 2 queued, 3/hour quota', () => {
  assert.strictEqual(config.USER_LIMITS.maxActiveJobs, 1);
  assert.strictEqual(config.USER_LIMITS.maxQueuedJobs, 2);
  assert.strictEqual(config.USER_LIMITS.quotaLimit, 3);
});

test('cache TTL: immutable data has long TTL', () => {
  assert.ok(config.CACHE_TTL['evm-creation'].freshMs >= 180 * 24 * 60 * 60 * 1000);
  assert.strictEqual(config.CACHE_TTL['evm-creation'].staleMs, Infinity);
  assert.ok(config.CACHE_TTL['pump-create-signer'].freshMs >= 180 * 24 * 60 * 60 * 1000);
});

test('cache TTL: dynamic data has short TTL', () => {
  assert.ok(config.CACHE_TTL['market-data'].freshMs <= 5 * 60 * 1000);
  assert.ok(config.CACHE_TTL['honeypot-sellability'].freshMs <= 15 * 60 * 1000);
});

test('job states include all plan-defined states', () => {
  const expected = ['queued', 'running', 'partial', 'retrying', 'completed', 'completed_with_gaps', 'failed', 'cancelled'];
  for (const state of expected) {
    assert.ok(Object.values(config.JOB_STATES).includes(state), `Missing state: ${state}`);
  }
});

test('SSE stages match plan specification', () => {
  const expected = ['queued', 'security', 'verification', 'creator', 'wallet', 'finalizing', 'completed'];
  assert.deepStrictEqual(config.SSE_STAGES, expected);
});

// ─── Job Repository Tests ───────────────────────────────────────────────────
console.log('\nJob Repository Module:');

const jobRepo = require('../queue/job-repository');

test('createJob creates a valid job', () => {
  const job = jobRepo.createJob({
    assetKey: 'solana:testaddr:v2',
    chain: 'solana',
    address: 'testaddr',
    ownerWalletHash: 'hash1',
    ownerIpHash: 'hash2',
  });
  assert.ok(job.id);
  assert.strictEqual(job.status, 'queued');
  assert.strictEqual(job.chain, 'solana');
  assert.strictEqual(job.assetKey, 'solana:testaddr:v2');
  assert.ok(job.createdAt);
});

test('findJob finds created job', () => {
  const job = jobRepo.createJob({
    assetKey: 'solana:findtest:v2',
    chain: 'solana',
    address: 'findtest',
    ownerWalletHash: 'hash3',
    ownerIpHash: 'hash4',
  });
  const found = jobRepo.findJob(job.id);
  assert.ok(found);
  assert.strictEqual(found.id, job.id);
});

test('findActiveJobByAsset returns active job for deduplication', () => {
  const job = jobRepo.createJob({
    assetKey: 'solana:dedupetest:v2',
    chain: 'solana',
    address: 'dedupetest',
    ownerWalletHash: 'hash5',
    ownerIpHash: 'hash6',
  });
  const active = jobRepo.findActiveJobByAsset('solana:dedupetest:v2');
  assert.ok(active);
  assert.strictEqual(active.id, job.id);
});

test('updateJob changes status correctly', () => {
  const job = jobRepo.createJob({
    assetKey: 'solana:updatetest:v2',
    chain: 'solana',
    address: 'updatetest',
    ownerWalletHash: 'hash7',
    ownerIpHash: 'hash8',
  });
  const updated = jobRepo.updateJob(job.id, { status: 'running', stage: 'security' });
  assert.strictEqual(updated.status, 'running');
  assert.strictEqual(updated.stage, 'security');
});

test('countUserJobs counts active and queued correctly', () => {
  const counts = jobRepo.countUserJobs('hash5');
  assert.ok(typeof counts.active === 'number');
  assert.ok(typeof counts.queued === 'number');
});

test('addWatcher creates a watcher entry', () => {
  const job = jobRepo.createJob({
    assetKey: 'solana:watchertest:v2',
    chain: 'solana',
    address: 'watchertest',
    ownerWalletHash: 'hash9',
    ownerIpHash: 'hash10',
  });
  const watcher = jobRepo.addWatcher(job.id, 'watcher-hash-1');
  assert.ok(watcher);
  assert.strictEqual(watcher.jobId, job.id);

  const watchers = jobRepo.getWatchers(job.id);
  assert.ok(watchers.length >= 1);
});

test('saveReport and findReport work correctly', () => {
  const report = {
    assetKey: 'solana:reporttest:v2',
    version: 'v2',
    chain: 'solana',
    address: 'reporttest',
    score: 75,
    data: { test: true },
  };
  jobRepo.saveReport(report);
  const found = jobRepo.findReport('solana:reporttest:v2', 'v2');
  assert.ok(found);
  assert.strictEqual(found.score, 75);
});

test('auditLog records events', () => {
  jobRepo.auditLog('test-actor', 'test-action', 'test-target', { detail: 'test' });
  // No error = success (file written)
  assert.ok(true);
});

test('recordProviderMetric tracks metrics', () => {
  const bucket = jobRepo.recordProviderMetric({
    provider: 'GoPlus',
    endpointClass: 'token-security',
    keyId: 'test-key',
    latencyMs: 150,
    success: true,
    statusCode: 200,
  });
  assert.ok(bucket);
  assert.ok(bucket.requests >= 1);
});

// ─── Orchestrator Tests ─────────────────────────────────────────────────────
console.log('\nOrchestrator Module:');

const { canonicalAddress, assetKey, privacyHash } = require('../queue/orchestrator');

test('canonicalAddress validates Solana addresses', () => {
  assert.ok(canonicalAddress('solana', '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'));
  assert.strictEqual(canonicalAddress('solana', 'invalid'), null);
  assert.strictEqual(canonicalAddress('unknown-chain', 'addr'), null);
});

test('canonicalAddress validates EVM addresses', () => {
  const result = canonicalAddress('ethereum', '0xdAC17F958D2ee523a2206206994597C13D831ec7');
  assert.ok(result);
  assert.strictEqual(result, '0xdac17f958d2ee523a2206206994597c13d831ec7');
});

test('assetKey creates deterministic key', () => {
  const key = assetKey('solana', 'testaddr');
  assert.strictEqual(key, 'solana:testaddr:v2');
});

test('privacyHash creates consistent HMAC', () => {
  const salt = Buffer.from('test-salt');
  const hash1 = privacyHash('wallet-address', salt);
  const hash2 = privacyHash('wallet-address', salt);
  assert.strictEqual(hash1, hash2);

  const hash3 = privacyHash('different-wallet', salt);
  assert.notStrictEqual(hash1, hash3);
});

// ─── Cache Adapter Tests ────────────────────────────────────────────────────
console.log('\nCache Adapter Module (L1 only, no Redis):');

const { cacheKey, recordCacheHit, getCacheStats } = require('../queue/cache-adapter');

test('cacheKey generates versioned keys', () => {
  const key = cacheKey('full-report', 'solana', 'testaddr');
  assert.ok(key.includes('v2'));
  assert.ok(key.includes('solana'));
  assert.ok(key.includes('testaddr'));
});

test('cache stats track hits and misses', () => {
  recordCacheHit('fresh');
  recordCacheHit('fresh');
  recordCacheHit('stale');
  recordCacheHit('expired');
  const stats = getCacheStats();
  assert.ok(stats.hits >= 2);
  assert.ok(stats.staleHits >= 1);
  assert.ok(stats.misses >= 1);
});

// ─── Workers Module Tests ───────────────────────────────────────────────────
console.log('\nWorkers Module:');

const { assembleReport, NonRetryableError } = require('../queue/workers');

test('assembleReport creates a valid report structure', () => {
  const report = assembleReport({
    chain: 'solana',
    address: 'testaddr',
    assetKey: 'solana:testaddr:v2',
    security: { signals: [] },
    creator: { creator: { address: 'creator1' } },
    wallet: null,
    stages: [{ name: 'goplus', status: 'completed' }],
    errors: [],
  });
  assert.ok(report.assetKey);
  assert.strictEqual(report.chain, 'solana');
  assert.ok(report.timestamps.assembled);
  assert.ok(report.creator);
});

test('NonRetryableError has correct properties', () => {
  const err = new NonRetryableError('Bad request', 400);
  assert.strictEqual(err.name, 'NonRetryableError');
  assert.strictEqual(err.statusCode, 400);
  assert.ok(err instanceof Error);
});

// ─── Summary ────────────────────────────────────────────────────────────────
console.log('\n═══════════════════════════════════════════════════');
console.log(` Results: ${passed} passed, ${failed} failed`);
console.log('═══════════════════════════════════════════════════\n');

process.exit(failed > 0 ? 1 : 0);
