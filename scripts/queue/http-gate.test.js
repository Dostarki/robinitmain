const {test} = require('node:test');
const assert = require('node:assert/strict');
const {createGatedFetch,providerFor} = require('./http-gate');
test('physical HTTP requests each acquire and release a permit, including auth and retries',async()=>{
  let acquired=0,released=0,cooldown;
  const gate=createGatedFetch({limiter:{acquire:async()=>({allowed:true,leaseId:String(++acquired)}),release:async()=>released++,setCooldown:async(...args)=>{cooldown=args;}},fetcher:async()=>new Response('{}',{status:429,headers:{'retry-after':'30'}})});
  await gate('https://api.gopluslabs.io/api/v1/token');
  await gate('https://api.gopluslabs.io/api/v1/token_security/1');
  assert.equal(acquired,2);assert.equal(released,2);assert.equal(cooldown[2],30000);
});
test('Redis failure never bypasses the provider gate; unknown hosts cannot leak keys',async()=>{
  let calls=0;
  const gate=createGatedFetch({limiter:{acquire:async()=>{throw Error('Redis down');}},fetcher:async()=>calls++});
  await assert.rejects(gate('https://api.gopluslabs.io/api/v1/token'),/Redis down/);
  await assert.rejects(gate('https://api.gopluslabs.io.attacker.test/'),/Unsupported/);
  assert.equal(calls,0);
  assert.equal(providerFor('https://mainnet.helius-rpc.com/',JSON.stringify({method:'getAsset'})),'helius-das');
});
