const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const Redis = require('ioredis');
const { Queue, Worker, QueueEvents, DelayedError } = require('bullmq');
const { ProviderRateLimiter } = require('./rate-limiter');

test('real Redis: 100 concurrent permits respect concurrency, leases recover, cooldown cannot shorten', async () => {
  const prefix = 'ri-test-' + crypto.randomUUID() + ':';
  const redis = new Redis({ host: '127.0.0.1', port: 6379, keyPrefix: prefix, maxRetriesPerRequest: 1 });
  let now = Date.now();
  const limiter = new ProviderRateLimiter({ connection: () => redis, now: () => now, leaseMs: 100 });
  try {
    await redis.ping();
    const permits = await Promise.all(Array.from({ length: 100 }, () => limiter.acquire('goplus-security')));
    const accepted = permits.filter(p => p.allowed);
    assert.equal(accepted.length, 2);
    await limiter.release('goplus-security', accepted[0].leaseId);
    await limiter.release('goplus-security', accepted[0].leaseId);
    assert.equal((await limiter.snapshot())['goplus-security'].inFlight, 1);
    assert.equal(await limiter.renew('goplus-security', accepted[1].leaseId), 1);
    now += 101;
    assert.equal(await limiter.renew('goplus-security', accepted[1].leaseId), 0);
    assert.equal((await limiter.snapshot())['goplus-security'].inFlight, 0);
    await limiter.setCooldown('goplus-security', 5000);
    await limiter.setCooldown('goplus-security', 1000);
    assert.equal((await limiter.acquire('goplus-security')).retryAfterMs, 5000);
    now += 5001;
    assert.equal((await limiter.acquire('goplus-security')).allowed, true);
  } finally {
    // Delete only the exact randomly namespaced test keys.
    for (const name of Object.keys(require('./config').PROVIDER_LIMITS)) {
      await redis.del(`ratelimit:{${name}}`, `ratelimit:{${name}}:leases`);
    }
    await redis.quit();
  }
});

test('real BullMQ: a delayed original job resolves once with its real result', async () => {
  const name = 'ri-test-' + crypto.randomUUID();
  const connection = { host: '127.0.0.1', port: 6379, maxRetriesPerRequest: null };
  const queue = new Queue(name, { connection });
  const events = new QueueEvents(name, { connection });
  let runs = 0;
  const worker = new Worker(name, async (job, token) => {
    runs++;
    if (runs === 1) { await job.moveToDelayed(Date.now() + 100, token); throw new DelayedError(); }
    return { score: 42 };
  }, { connection });
  try {
    await events.waitUntilReady();
    const job = await queue.add('analysis', {});
    assert.deepEqual(await job.waitUntilFinished(events, 10000), { score: 42 });
    assert.equal(runs, 2);
    assert.equal(await job.getState(), 'completed');
  } finally {
    await worker.close(); await events.close();
    await queue.obliterate({ force: true }); await queue.close();
  }
});
