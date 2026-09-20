const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Pool } = require('pg');
const Redis = require('ioredis');
const { setTimeout: delay } = require('node:timers/promises');
const { DurableRuntime } = require('./durable-runtime');
const { PostgresStore } = require('./postgres-store');
const { privacyHash } = require('./orchestrator');

test('durable runtime: 60 distinct jobs, private history, cached access and invalidation', {timeout:60000}, async () => {
  const schema = 'ri_test_' + randomUUID().replaceAll('-','');
  const pool = new Pool({host:'/var/run/postgresql',user:'postgres',database:'postgres',max:8});
  const store = new PostgresStore({pool,schema});
  const connection = new Redis({host:'127.0.0.1',port:6379,maxRetriesPerRequest:null});
  let calls = 0;
  const runtime = new DurableRuntime({store,connection,queueName:'ri-test-'+randomUUID(),hashSalt:'test-salt',
    analyze:async (chain,address) => { calls++; await delay(10); return {chain,address,score:75,analyzedAt:Date.now()}; },
    enrich:async () => ({creator:{address:'verified'}}),
  });
  try {
    await runtime.start({migrate:true});
    const requests = Array.from({length:60},(_,i) => ({chain:'ethereum',address:'0x'+(i+1).toString(16).padStart(40,'0'),walletAddress:'wallet-'+i,clientIp:'ip-'+i}));
    const results = await Promise.all(requests.map(x=>runtime.submitAnalysis(x)));
    assert.ok(results.every(x=>x.status===202));
    const ids = results.map(x=>x.body.jobId);
    assert.equal((await runtime.getJobStatus(ids[0],privacyHash('outsider','test-salt'))).status,404);
    const until = Date.now()+30000;
    while(Date.now()<until) {
      const jobs = await Promise.all(ids.map(id=>store.job(id)));
      if(jobs.every(j=>j.status==='completed')) break;
      await delay(100);
    }
    assert.equal(calls,60);
    assert.ok((await Promise.all(ids.map(id=>store.job(id)))).every(j=>j.status==='completed'));
    const wallet = privacyHash('wallet-0','test-salt');
    assert.equal((await store.history(wallet)).length,1);
    assert.equal((await store.history('outsider')).length,0);
    const cached = await runtime.submitAnalysis(requests[0]);
    assert.equal(cached.status,200); assert.equal(cached.body.report.cached,true);
    await store.invalidate('ethereum',requests[0].address);
    assert.equal(await store.fresh(require('./orchestrator').assetKey('ethereum',requests[0].address),wallet),null);
  } finally {
    clearInterval(runtime.timer);
    await runtime.worker?.close();
    await runtime.queue.obliterate({force:true}); await runtime.queue.close();
    await connection.quit();
    await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await pool.end();
  }
});
