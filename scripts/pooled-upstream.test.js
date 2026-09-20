const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {KeyPool}=require('./key-pool');
// Exercise the server adapter without starting its listener or reading production credentials.
const source=fs.readFileSync(require.resolve('./serve-app'),'utf8');
const adapter=source.slice(source.indexOf('async function upstreamPooled('),source.indexOf('function truth('));
test('GoPlus attaches selected credential, tracks it once and fails over after rate limiting',async()=>{
  const pool=new KeyPool({env:{GOPLUS_ACCESS_TOKEN:'first'}});
  pool.pools.get('GoPlus').push({...pool.pools.get('GoPlus')[0],keyId:'second',secret:'second'});
  const headers=[];
  const context=vm.createContext({keyPool:pool,AbortSignal,gatedFetch:async(url,options)=>{
    headers.push(options.headers.Authorization);
    return headers.length===1?{ok:false,status:429}:{ok:true,status:200,json:async()=>({code:1,result:{}})};
  },upstream:()=>{throw Error('Unexpected public fallback');}});
  vm.runInContext(adapter,context);
  await context.upstreamPooled('GoPlus',()=> 'https://api.gopluslabs.io/example');
  assert.deepEqual(headers,['first','second']);
  assert.equal(pool.snapshot()[0].monthlyRequests,1);assert.equal(pool.snapshot()[1].monthlySuccesses,1);
});
test('configured but paused credentials cannot silently fall back to public access',async()=>{
  const pool=new KeyPool({env:{GOPLUS_ACCESS_TOKEN:'first'}});pool.pools.get('GoPlus')[0].active=false;
  const context=vm.createContext({keyPool:pool,upstream:()=>{throw Error('Unexpected fallback');}});
  vm.runInContext(adapter,context);
  await assert.rejects(context.upstreamPooled('GoPlus',()=> 'unused'),/No eligible API key/);
});
