const {test} = require('node:test');
const assert = require('node:assert/strict');
const { KeyPool } = require('./key-pool');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('least request count wins over oldest timestamp, with in-flight reservations', () => {
  const pool = new KeyPool({env:{}});
  const month = new Date().toISOString().slice(0,7);
  pool.pools.set('Helius', [
    {keyId:'a',secret:'a',month,monthlyRequests:10,lastUsedAt:1},
    {keyId:'b',secret:'b',month,monthlyRequests:1,lastUsedAt:100},
    {keyId:'c',secret:'c',month,monthlyRequests:1,lastUsedAt:200},
  ]);
  assert.equal(pool.getKey('Helius').keyId,'b');
  assert.equal(pool.getKey('Helius').keyId,'c');
});
test('expiry, pause, cooldown and monthly budget exclusions are consistent', () => {
  const pool = new KeyPool({env:{}}), month = new Date().toISOString().slice(0,7);
  pool.pools.set('Helius', [
    {keyId:'expired',secret:'a',expiresAt:Date.now()-1000},
    {keyId:'paused',secret:'b',active:false},
    {keyId:'cooldown',secret:'c',cooldownUntil:Date.now()+10000},
    {keyId:'quota',secret:'d',month,monthlyRequests:2,monthlyLimit:2},
    {keyId:'ready',secret:'e',expiresAt:Date.now()+10000},
  ]);
  assert.equal(pool.getKey('Helius').keyId,'ready');
  assert.equal(pool.status().Helius.active,1);
});
test('hasKeys and status do not reserve or modify last-use time', () => {
  const pool = new KeyPool({env:{HELIUS_API_KEY:'example'}});
  pool.hasKeys('Helius'); pool.status(); pool.snapshot();
  const entry=pool.pools.get('Helius')[0];
  assert.equal(entry.inFlight,0); assert.equal(entry.lastUsedAt,null);
});
test('environment counters survive reload and restart; snapshots never expose secrets', t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ri-pool-test-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const config={apiKeysPath:path.join(dir,'keys.json'),env:{HELIUS_API_KEY:'private-value-1234'}};
  fs.writeFileSync(config.apiKeysPath,JSON.stringify({keys:[]}));
  let pool=new KeyPool(config);
  pool.recordUsage(pool.getKey('Helius').keyId,true,{status:200});
  pool.configure('env-helius',10,null);
  pool.reload(); pool=new KeyPool(config);
  const row=pool.snapshot()[0];
  assert.equal(row.monthlyRequests,1);assert.equal(row.quotaPercent,10);assert.equal(row.trafficPercent,100);
  assert.equal(JSON.stringify(row).includes('private-value'),false);
  assert.equal(fs.readFileSync(pool.usagePath,'utf8').includes('private-value'),false);
});
test('calendar-month rollover preserves lifetime count', () => {
  const pool=new KeyPool({env:{HELIUS_API_KEY:'secret'}}), entry=pool.pools.get('Helius')[0];
  Object.assign(entry,{month:'2020-01',monthlyRequests:200,requestCount:200,monthlyLimit:20});
  assert.equal(pool.hasKeys('Helius'),true);
  assert.equal(pool.snapshot()[0].monthlyRequests,0);
  assert.equal(pool.snapshot()[0].requestCount,200);
});

// Test 1: Basic getKey with manually set pool
test("getKey with manually set pool - LRU selection", () => {
  const pool = new KeyPool({
    apiKeysPath: null,
    keyFn: (secret) => secret,
    env: {},
  });
  // Directly set keys for a provider
  pool.pools.set("TestProvider", [
    { keyId: "key1", secret: "secret1", lastUsedAt: 100 },
    { keyId: "key2", secret: "secret2", lastUsedAt: 200 },
    { keyId: "key3", secret: "secret3", lastUsedAt: 50 },
  ]);

  const key = pool.getKey("TestProvider");
  assert.ok(key !== null, "key should not be null");
  assert.strictEqual(key.keyId, "key3", "should select oldest key (lastUsedAt: 50)");
});

// Test 2: getKey returns null when pool is empty
test("getKey returns null for empty pool", () => {
  const pool = new KeyPool({
    apiKeysPath: null,
    keyFn: (secret) => secret,
    env: {},
  });

  const key = pool.getKey("EmptyProvider");
  assert.strictEqual(key, null, "should return null for empty pool");
});

// Test 3: hasKeys works
test("hasKeys basic", () => {
  const pool = new KeyPool({
    apiKeysPath: null,
    keyFn: (secret) => secret,
    env: { HELIUS_API_KEY: "key" },
  });
  assert.strictEqual(pool.hasKeys("Helius"), true);
});

// Test 4: recordUsage basic
test("recordUsage success", () => {
  const pool = new KeyPool({
    apiKeysPath: null,
    keyFn: (secret) => secret,
    env: {},
  });
  pool.pools.set("TestProvider", [
    { keyId: "key1", secret: "secret1", requestCount: 0, successCount: 0, consecutiveErrors: 0 },
  ]);

  pool.recordUsage("key1", true);
  const entry = pool.pools.get("TestProvider")[0];
  assert.strictEqual(entry.requestCount, 1);
  assert.strictEqual(entry.successCount, 1);
  assert.strictEqual(entry.consecutiveErrors, 0);
});

// Test 5: recordUsage failure with cooldown
test("recordUsage failure triggers cooldown", () => {
  const pool = new KeyPool({
    apiKeysPath: null,
    keyFn: (secret) => secret,
    env: {},
  });
  pool.pools.set("TestProvider", [
    { keyId: "key1", secret: "secret1", requestCount: 0, successCount: 0, consecutiveErrors: 0 },
  ]);

  pool.recordUsage("key1", false);
  pool.recordUsage("key1", false);
  pool.recordUsage("key1", false);

  const entry = pool.pools.get("TestProvider")[0];
  assert.strictEqual(entry.consecutiveErrors, 3);
  assert.ok(entry.cooldownUntil > 0);
});

// Test 6: status basic
test("status basic", () => {
  const pool = new KeyPool({
    apiKeysPath: null,
    keyFn: (secret) => secret,
    env: {},
  });
  pool.pools.set("TestProvider", [
    { keyId: "key1", secret: "secret1", active: true, requestCount: 5, consecutiveErrors: 0, monthlyLimit: 0 },
  ]);

  const status = pool.status();
  assert.ok(status.TestProvider !== undefined);
  assert.strictEqual(status.TestProvider.total, 1);
  assert.strictEqual(status.TestProvider.active, 1);
  assert.strictEqual(status.TestProvider.totalRequests, 5);
});
