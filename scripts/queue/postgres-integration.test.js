const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Pool } = require('pg');
const { PostgresStore } = require('./postgres-store');
const { Queue } = require('bullmq');
const { OutboxRelay } = require('./outbox-relay');

test('Postgres: concurrent dedupe, owner isolation, dispatch limit, durable quota and transactional outbox', async () => {
  // Run in WSL as postgres, using peer authentication; no application credentials.
  const schema = 'ri_test_' + randomUUID().replaceAll('-', '');
  const pool = new Pool({ host: '/var/run/postgresql', user: 'postgres', database: 'postgres', max: 8 });
  const store = new PostgresStore({ pool, schema });
  const input = { asset: 'solana:mint:v2', chain: 'solana', address: 'mint', wallet: 'hash-a', ip: 'hash-ip' };
  try {
    await store.migrate();
    const results = await Promise.all(Array.from({ length: 100 }, (_, i) => store.submit({ ...input, wallet: 'hash-' + i })));
    assert.equal(new Set(results.map(r => r.job.id)).size, 1);
    assert.equal(results.filter(r => !r.joined).length, 1);
    const first = results[0].job;
    assert.equal((await store.pendingOutbox()).length, 1);
    assert.equal(await store.status(first.id, 'unrelated'), null);
    assert.equal(await store.claim(first.id), true);
    const second = await store.submit({ ...input, asset: 'asset-two', wallet: first.wallet });
    assert.equal(await store.claim(second.job.id), false);
    await store.complete(first.id, { score: 65 });
    assert.equal(await store.claim(second.job.id), true);
    await store.complete(second.job.id, { score: 55 });
    const third = await store.submit({ ...input, asset: 'asset-three', wallet: first.wallet });
    await store.complete(third.job.id, { score: 45 });
    // A fresh repository instance must enforce the persisted quota.
    const restarted = new PostgresStore({ pool, schema });
    assert.equal((await restarted.submit({ ...input, asset: 'fourth', wallet: first.wallet })).denied, 'hourly_limit');
    assert.equal((await store.history('unrelated')).length, 0);
    assert.equal((await store.history(first.wallet)).length, 3);
    assert.equal((await store.history('hash-99')).length, 1);
    await store.markSent(first.id);
    assert.equal((await store.pendingOutbox()).length, 2);
  } finally {
    // Only the randomly generated test schema is removed.
    await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await store.close();
  }
});

test('Postgres + BullMQ: crash between enqueue and acknowledgment replays exactly one job', async () => {
  const schema = 'ri_test_' + randomUUID().replaceAll('-', '');
  const pool = new Pool({ host: '/var/run/postgresql', user: 'postgres', database: 'postgres' });
  const store = new PostgresStore({ pool, schema });
  const queue = new Queue('ri-test-' + randomUUID(), { connection: { host: '127.0.0.1', port: 6379, maxRetriesPerRequest: 1 } });
  try {
    await store.migrate();
    const created = await store.submit({ asset: 'asset', chain: 'solana', address: 'mint', wallet: 'hash-wallet', ip: 'hash-ip' });
    const original = store.markSent.bind(store);
    store.markSent = async () => { throw Error('simulated acknowledgment outage'); };
    await assert.rejects(new OutboxRelay({ store, queue }).flush(), /acknowledgment outage/);
    assert.equal((await store.pendingOutbox()).length, 1);
    store.markSent = original;
    assert.equal(await new OutboxRelay({ store, queue }).flush(), 1);
    assert.equal((await store.pendingOutbox()).length, 0);
    assert.equal(await queue.getWaitingCount(), 1);
    assert.deepEqual((await queue.getJob(created.job.id)).data, { jobId: created.job.id });
  } finally {
    await queue.obliterate({ force: true });
    await queue.close();
    await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await store.close();
  }
});
