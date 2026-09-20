const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { RiskAccess } = require('./risk-access');

test('allows three analyses then blocks the same wallet or IP for one hour', () => {
  let clock = 1_000_000;
  const access = new RiskAccess({ now: () => clock });
  for (let i = 0; i < 3; i++) assert.equal(access.consume({ wallet: 'wallet-a', ip: 'ip-a' }).allowed, true);
  assert.equal(access.consume({ wallet: 'wallet-a', ip: 'ip-b' }).allowed, false);
  assert.equal(access.consume({ wallet: 'wallet-b', ip: 'ip-a' }).allowed, false);
  clock += 60 * 60 * 1000 + 1;
  assert.equal(access.consume({ wallet: 'wallet-a', ip: 'ip-a' }).allowed, true);
});
test('persists hashed identifiers without exposing a wallet or address source', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-access-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const filePath = path.join(dir, 'limits.json');
  new RiskAccess({ filePath }).consume({ wallet: 'h-wallet', ip: 'h-ip' });
  const restored = new RiskAccess({ filePath });
  assert.equal(restored.inspect({ wallet: 'h-wallet', ip: 'h-ip' }).used, 1);
});
test('failed work can release its reservation without spending a completed-analysis slot', () => {
  const access = new RiskAccess(); const identity = { wallet: 'wallet-a', ip: 'ip-a' };
  const work = access.begin(identity); assert.ok(work.reservation); access.release(work.reservation);
  assert.equal(access.inspect(identity).used, 0);
  const committed = access.begin(identity); access.commit(committed.reservation);
  assert.equal(access.inspect(identity).used, 1);
});
