const { test } = require('node:test');
const assert = require('node:assert/strict');
const { OutboxRelay } = require('./outbox-relay');

test('outbox retries the same ID after acknowledgment failure without exposing identities', async () => {
  let acknowledged = false;
  let crash = true;
  const deliveries = [];
  const store = {
    pendingOutbox: async () => acknowledged ? [] : [{ id: 'opaque-id', status: 'queued', wallet: 'private', ip: 'private' }],
    markSent: async () => { if (crash) { crash = false; throw Error('DB unavailable'); } acknowledged = true; },
  };
  const queue = { add: async (...args) => deliveries.push(args) };
  await assert.rejects(new OutboxRelay({ store, queue }).flush(), /DB unavailable/);
  assert.equal(acknowledged, false);
  const restarted = new OutboxRelay({ store, queue });
  const first = restarted.flush();
  assert.equal(restarted.flush(), first);
  await first;
  assert.equal(acknowledged, true);
  assert.deepEqual(deliveries[0], deliveries[1]);
  assert.deepEqual(deliveries[0][1], { jobId: 'opaque-id' });
  assert.equal(deliveries[0][2].removeOnComplete, false);
});

test('outbox never acknowledges Redis failure or reenqueues terminal work', async () => {
  let ack = 0;
  let calls = 0;
  let status = 'queued';
  const relay = new OutboxRelay({
    store: { pendingOutbox: async () => [{ id: 'id', status }], markSent: async () => { ack++; } },
    queue: { add: async () => { calls++; throw Error('Redis unavailable'); } },
  });
  await assert.rejects(relay.flush(), /Redis unavailable/);
  assert.equal(ack, 0);
  status = 'completed';
  await relay.flush();
  assert.equal(ack, 1);
  assert.equal(calls, 1);
});
