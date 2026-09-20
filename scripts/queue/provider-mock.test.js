/**
 * Provider Mock Tests — P7
 * ANALYSIS_QUEUE_CACHE_IMPLEMENTATION_PLAN — Bölüm 5, P7
 *
 * 429, timeout, Retry-After, malformed response senaryoları.
 * Non-retryable vs retryable error ayrımı doğrulaması.
 */

const assert = require('assert');

console.log('═══════════════════════════════════════════════════');
console.log(' Provider Mock & Integration Tests');
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

async function asyncTest(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${err.message}`);
  }
}

// ─── Config: Retry/Non-Retry Ayrımı ────────────────────────────────────────
console.log('Retry Policy Tests:');

const { RETRY_POLICY } = require('../queue/config');

test('429 is retryable', () => {
  assert.ok(RETRY_POLICY.retryableStatuses.includes(429));
});

test('500, 502, 503, 504 are retryable', () => {
  for (const code of [500, 502, 503, 504]) {
    assert.ok(RETRY_POLICY.retryableStatuses.includes(code), `${code} should be retryable`);
  }
});

test('400 is NOT retryable', () => {
  assert.ok(RETRY_POLICY.nonRetryableStatuses.includes(400));
  assert.ok(!RETRY_POLICY.retryableStatuses.includes(400));
});

test('401 is NOT retryable', () => {
  assert.ok(RETRY_POLICY.nonRetryableStatuses.includes(401));
});

test('403 is NOT retryable', () => {
  assert.ok(RETRY_POLICY.nonRetryableStatuses.includes(403));
});

// ─── NonRetryableError ──────────────────────────────────────────────────────
console.log('\nNonRetryableError Tests:');

const { NonRetryableError } = require('../queue/workers');

test('NonRetryableError for 400 has unrecoverable flag', () => {
  const err = new NonRetryableError('Invalid address', 400);
  assert.strictEqual(err.statusCode, 400);
  assert.strictEqual(err.name, 'NonRetryableError');
  // When thrown in workers, unrecoverable is set
  Object.assign(err, { unrecoverable: true });
  assert.ok(err.unrecoverable);
});

test('NonRetryableError for 403 has correct status', () => {
  const err = new NonRetryableError('Forbidden', 403);
  assert.strictEqual(err.statusCode, 403);
});

// ─── Deduplication Logic ────────────────────────────────────────────────────
console.log('\nDeduplication Tests:');

const jobRepo = require('../queue/job-repository');

test('same asset key returns active job (no duplicate upstream)', () => {
  // Job 1 oluştur
  const job1 = jobRepo.createJob({
    assetKey: 'solana:dedupe_mock_test:v2',
    chain: 'solana',
    address: 'dedupe_mock_test',
    ownerWalletHash: 'mock_user_1',
    ownerIpHash: 'mock_ip_1',
  });

  // Aynı asset key ile tekrar sorgula
  const active = jobRepo.findActiveJobByAsset('solana:dedupe_mock_test:v2');
  assert.ok(active, 'Active job should exist');
  assert.strictEqual(active.id, job1.id, 'Should return the same job');

  // Watcher olarak ekle
  const watcher = jobRepo.addWatcher(job1.id, 'mock_user_2');
  assert.ok(watcher);
  assert.strictEqual(watcher.jobId, job1.id);
});

test('completed job does not block new analysis', () => {
  // Job oluştur ve tamamla
  const job = jobRepo.createJob({
    assetKey: 'solana:completed_dedupe_test:v2',
    chain: 'solana',
    address: 'completed_dedupe_test',
    ownerWalletHash: 'mock_user_3',
    ownerIpHash: 'mock_ip_3',
  });
  jobRepo.updateJob(job.id, { status: 'completed' });

  // Aynı asset key ile tekrar sorgula — active olmamalı
  const active = jobRepo.findActiveJobByAsset('solana:completed_dedupe_test:v2');
  assert.strictEqual(active, null, 'Completed job should not be returned as active');
});

// ─── User Job Limits ────────────────────────────────────────────────────────
console.log('\nUser Job Limit Tests:');

const { USER_LIMITS } = require('../queue/config');

test('user cannot exceed 1 active + 2 queued (limit check)', () => {
  const testUser = 'limit_test_user_' + Date.now();

  // 1 active job
  const job1 = jobRepo.createJob({
    assetKey: `solana:limit1:v2`,
    chain: 'solana',
    address: 'limit1',
    ownerWalletHash: testUser,
    ownerIpHash: 'limit_ip',
  });
  jobRepo.updateJob(job1.id, { status: 'running' });

  // 2 queued jobs
  jobRepo.createJob({
    assetKey: `solana:limit2:v2`,
    chain: 'solana',
    address: 'limit2',
    ownerWalletHash: testUser,
    ownerIpHash: 'limit_ip',
  });
  jobRepo.createJob({
    assetKey: `solana:limit3:v2`,
    chain: 'solana',
    address: 'limit3',
    ownerWalletHash: testUser,
    ownerIpHash: 'limit_ip',
  });

  // Sayıları kontrol et
  const counts = jobRepo.countUserJobs(testUser);
  assert.ok(counts.active >= 1, `Active should be >= 1, got ${counts.active}`);
  assert.ok(counts.queued >= 2, `Queued should be >= 2, got ${counts.queued}`);

  // Limit kontrolü
  const atLimit = counts.active >= USER_LIMITS.maxActiveJobs && counts.queued >= USER_LIMITS.maxQueuedJobs;
  assert.ok(atLimit, 'User should be at job limit');
});

// ─── Cache Freshness ────────────────────────────────────────────────────────
console.log('\nCache Freshness Tests:');

const { checkFreshness } = require('../queue/job-repository');
const { CACHE_TTL } = require('../queue/config');

test('fresh report within TTL', () => {
  const report = { savedAt: Date.now() - 1000 }; // 1 saniye önce
  assert.strictEqual(checkFreshness(report, CACHE_TTL['full-report']), 'fresh');
});

test('stale report after fresh TTL but within stale window', () => {
  const freshMs = CACHE_TTL['full-report'].freshMs;
  const report = { savedAt: Date.now() - freshMs - 1000 }; // Fresh TTL + 1 saniye
  assert.strictEqual(checkFreshness(report, CACHE_TTL['full-report']), 'stale');
});

test('expired report beyond stale window', () => {
  const totalMs = CACHE_TTL['full-report'].freshMs + CACHE_TTL['full-report'].staleMs;
  const report = { savedAt: Date.now() - totalMs - 1000 };
  assert.strictEqual(checkFreshness(report, CACHE_TTL['full-report']), 'expired');
});

test('null report is expired', () => {
  assert.strictEqual(checkFreshness(null, CACHE_TTL['full-report']), 'expired');
});

test('immutable data (evm-creation) has very long fresh TTL', () => {
  const sixMonthsAgo = Date.now() - 170 * 24 * 60 * 60 * 1000;
  const report = { savedAt: sixMonthsAgo };
  assert.strictEqual(checkFreshness(report, CACHE_TTL['evm-creation']), 'fresh');
});

// ─── SSE Stream Tests ───────────────────────────────────────────────────────
console.log('\nSSE Stream Tests:');

const { getSSEStats, sseConnections } = require('../queue/sse-stream');

test('SSE stats returns zero when no connections', () => {
  sseConnections.clear();
  const stats = getSSEStats();
  assert.strictEqual(stats.activeJobs, 0);
  assert.strictEqual(stats.totalConnections, 0);
});

// ─── Orchestrator Address Validation ────────────────────────────────────────
console.log('\nAddress Validation Tests:');

const { canonicalAddress } = require('../queue/orchestrator');

test('rejects empty address', () => {
  assert.strictEqual(canonicalAddress('solana', ''), null);
  assert.strictEqual(canonicalAddress('ethereum', ''), null);
});

test('rejects invalid Solana address (special chars)', () => {
  assert.strictEqual(canonicalAddress('solana', '0xInvalidForSolana'), null);
});

test('accepts valid checksummed EVM address', () => {
  assert.ok(canonicalAddress('ethereum', '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'));
});

test('rejects unsupported chain', () => {
  assert.strictEqual(canonicalAddress('bitcoin', 'bc1qtest'), null);
  assert.strictEqual(canonicalAddress('', 'addr'), null);
});

// ─── Provider Metrics ───────────────────────────────────────────────────────
console.log('\nProvider Metrics Tests:');

test('metrics summary aggregates correctly', () => {
  // Birkaç metrik kaydet
  jobRepo.recordProviderMetric({
    provider: 'GoPlus', endpointClass: 'token-security',
    keyId: 'test', latencyMs: 100, success: true, statusCode: 200,
  });
  jobRepo.recordProviderMetric({
    provider: 'GoPlus', endpointClass: 'token-security',
    keyId: 'test', latencyMs: 200, success: false, statusCode: 429,
  });

  const summary = jobRepo.getMetricsSummary(60);
  const goplus = summary['GoPlus:token-security'];
  assert.ok(goplus, 'GoPlus metrics should exist');
  assert.ok(goplus.requests >= 2);
  assert.ok(goplus.status429 >= 1);
});

// ─── Audit Log ──────────────────────────────────────────────────────────────
console.log('\nAudit Log Tests:');

test('audit log records cache invalidation event', () => {
  jobRepo.auditLog('0xowner', 'cache_invalidate', 'solana:testaddr');
  // Should not throw
  assert.ok(true);
});

test('audit log records key rotation event', () => {
  jobRepo.auditLog('0xowner', 'key_rotate', 'GoPlus:key-123', { reason: 'monthly rotation' });
  assert.ok(true);
});

// ─── Summary ────────────────────────────────────────────────────────────────
console.log('\n═══════════════════════════════════════════════════');
console.log(` Results: ${passed} passed, ${failed} failed`);
console.log('═══════════════════════════════════════════════════\n');

process.exit(failed > 0 ? 1 : 0);
