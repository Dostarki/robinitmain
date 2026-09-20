const {test} = require('node:test');
const assert = require('node:assert/strict');
const {createCreatorService,addressFor} = require('./risk-creator');
const evm = '0x' + '1'.repeat(40), wallet = '0x' + '2'.repeat(40), other = '0x' + '3'.repeat(40);
const mint = 'So11111111111111111111111111111111111111112';
const solWallet = 'GQUtvPx89ZNCwmvQqFmH59bJcU8fW8siETpaxod7Aydz';
const pumpMint = '111111111111111111111111111111111111pump';
const poolWallet = '7YttLkH9pZX7N8J6pTskdNbVLuQj47EVhjUj6cbazMxy';
const response = data => ({ok:true,json:async()=>data});

test('pooled HTTP failures count once and never fall back to environment credentials', async () => {
  const {KeyPool}=require('./key-pool');
  const pool=new KeyPool({env:{ETHERSCAN_API_KEY:'pool-secret'}});
  let calls=0;
  const service=createCreatorService({pool,env:{ETHERSCAN_API_KEY:'wrong-fallback'},usageFile:null,fetcher:async url=>{
    calls++; assert.equal(new URL(url).searchParams.get('apikey'),'pool-secret'); return {ok:false,status:429};
  }});
  await service.enrich({chain:'ethereum',address:evm});
  assert.equal(calls,1);assert.equal(pool.snapshot()[0].monthlyRequests,1);assert.equal(pool.snapshot()[0].monthlySuccesses,0);
  await service.enrich({chain:'ethereum',address:other});assert.equal(calls,1);
});
test('Helius DAS uses a pool key and is included in usage', async () => {
  const {KeyPool}=require('./key-pool');
  const pool=new KeyPool({env:{HELIUS_API_KEY:'das-pool-key'}});
  const service=createCreatorService({pool,env:{},usageFile:null,fetcher:async url=>{
    assert.equal(new URL(url).searchParams.get('api-key'),'das-pool-key');return response({result:{}});
  }});
  await service.enrich({chain:'solana',address:mint});
  assert.equal(pool.snapshot()[0].monthlyRequests,1);assert.equal(pool.snapshot()[0].monthlySuccesses,1);
});
test('No keys: no external requests, no fabricated metrics',async()=>{
  const service = createCreatorService({env:{},usageFile:null,fetcher:()=>{throw Error('Unexpected request');}});
  for(const chain of ['solana','ethereum']) {
    const r = await service.enrich({chain,address:chain === 'solana' ? mint : evm});
    assert.equal(r.creator,null);assert.equal(r.balances,null);assert.equal(r.rugHistory.percent,null);assert.equal(r.exchangeUsage,null);
    assert.equal(r.coverage.length,chain === 'solana' ? 2 : 1);
  }
});
test('Bitquery expired trial and paid Moralis credentials remain disabled',async()=>{
  const service = createCreatorService({env:{BITQUERY_ACCESS_TOKEN:'secret',BITQUERY_FREE_TRIAL_UNTIL:'2020-01-01',MORALIS_API_KEY:'secret'},usageFile:null,fetcher:()=>{throw Error('Unexpected request');}});
  assert.equal((await service.enrich({chain:'solana',address:mint})).creator,null);
  assert.equal((await service.enrich({chain:'ethereum',address:evm,creatorAddress:wallet})).balances,null);
});
test('EVM: Etherscan-only creator, deployments, native balance and movements',async()=>{
  const calls=[];
  const service = createCreatorService({env:{ETHERSCAN_API_KEY:'scan-secret',MORALIS_API_KEY:'wallet-secret',MORALIS_FREE_PLAN:'true'},usageFile:null,fetcher:async(url)=>{
    calls.push(url); const parsed = new URL(url);
    if(parsed.searchParams.get('action') === 'getcontractcreation') return response({status:'1',result:[{contractCreator:wallet,txHash:'0xtx',timestamp:'1704067200'}]});
    if(parsed.searchParams.get('action') === 'txlist') return response({status:'1',result:[{from:wallet,to:other,value:'200000000000000000',hash:'0xtx',isError:'0',contractAddress:other,timeStamp:'1704067200'}]});
    if(parsed.searchParams.get('action') === 'balance') return response({status:'1',result:'1500000000000000000'});
    throw Error('Unexpected endpoint');
  }});
  const report={chain:'ethereum',address:evm};
  const [a,b] = await Promise.all([service.enrich(report),service.enrich(report)]);
  assert.deepEqual(a,b);assert.equal(calls.length,3);assert.equal(a.creator.address,wallet);assert.equal(a.balances.items[0].balance,1.5);
  assert.equal(a.movements.items[0].amount,-0.2);assert.equal(a.exchangeUsage,null);
  assert.equal(a.launches.items[0].kind,'Unverified contract');assert.equal(a.rugHistory.percent,null);
  assert.equal((await service.enrich(report)).cached,true);assert.equal(calls.length,3);
  assert.ok(calls.every(url=>new URL(url).hostname === 'api.etherscan.io'));
  assert.ok(!JSON.stringify(a).includes('secret'));
});
test('Solana: free Helius snapshots, trial creator and bounded launch/DEX history',async()=>{
  const calls=[];let queries=0;
  const service=createCreatorService({env:{HELIUS_API_KEY:'helius-secret',BITQUERY_ACCESS_TOKEN:'bitquery-secret',BITQUERY_FREE_TRIAL_UNTIL:new Date(Date.now()+86400000).toISOString()},usageFile:null,fetcher:async(url,options)=>{
    calls.push(url);
    if(url.includes('bitquery')) {
      const query=JSON.parse(options.body).query;queries++;
      if(query.includes('Instructions(')) return response({data:{Solana:{Instructions:[{Transaction:{Signer:solWallet,Signature:'sig'},Block:{Time:'2024-01-01T00:00:00Z'}}]}}});
      if(query.includes('TokenSupplyUpdates')) return response({data:{Solana:{TokenSupplyUpdates:[]}}});
      return response({data:{Solana:{DEXTrades:[{Transaction:{Signature:'swap'},Trade:{Dex:{ProtocolName:'raydium'}}}]}}});
    }
    if(url.includes('/balances?')) return response({totalUsdValue:145,balances:[{symbol:'SOL',balance:1,usdValue:145}]});
    if(url.includes('/balance-at?')) return response({balance:'0.5'});
    return response({data:[{timestamp:1704067200,signature:'sig',error:null,balanceChanges:[{mint,amount:-0.05}]}]});
  }});
  const r=await service.enrich({chain:'solana',address:mint});
  assert.equal(r.creator.address,solWallet);assert.equal(r.balances.items[0].balance,1);assert.equal(r.movements.items[0].amount,-0.05);
  assert.equal(r.balanceHistory.items.length,2);assert.equal(r.exchangeUsage.swapTransactions,1);assert.equal(r.exchangeUsage.cexTransfers,null);assert.equal(queries,3);
  assert.ok(calls.every(url=>!url.includes('/identity')&&!url.includes('/funded-by')));assert.ok(!JSON.stringify(r).includes('secret'));
});
test('Quota errors do not leak upstream responses or credentials',async()=>{
  const service=createCreatorService({env:{ETHERSCAN_API_KEY:'secret'},usageFile:null,fetcher:async()=>({ok:false,status:429})});
  const r=await service.enrich({chain:'ethereum',address:evm});
  assert.equal(r.coverage[0].note,'Provider quota reached');assert.equal(r.creator,null);
});
test('Invalid address and unknown networks are rejected before fetch',async()=>{
  assert.equal(addressFor('ethereum','https://attacker.example'),null);
  assert.equal(addressFor('unknown',evm),null);
  const service=createCreatorService({env:{},usageFile:null});
  await assert.rejects(service.enrich({chain:'solana',address:'bad'}),/Invalid asset/);
});
test('A duplicated Bitquery token is never sent to Helius',async()=>{
  const service=createCreatorService({env:{HELIUS_API_KEY:'same-secret',BITQUERY_ACCESS_TOKEN:'same-secret'},usageFile:null,fetcher:()=>{throw Error('Unexpected request');}});
  const r=await service.enrich({chain:'solana',address:mint,creatorAddress:solWallet});
  assert.equal(r.balances,null);
  assert.match(r.coverage.find(item=>item.provider === 'Helius').note,/separate Helius/);
});
test('Account trial beyond seven days is accepted, but cutoff stops all Bitquery calls',async()=>{
  const start=Date.parse('2026-09-17T18:00:00Z'), expiry='2026-10-17T00:00:00+03:00';
  let clock=start,calls=0;
  const service=createCreatorService({env:{BITQUERY_ACCESS_TOKEN:'trial-secret',BITQUERY_FREE_TRIAL_UNTIL:expiry},now:()=>clock,usageFile:null,fetcher:async()=>{calls++;return response({data:{Solana:{Instructions:[]}}});}});
  const report={chain:'solana',address:mint};
  assert.equal((await service.enrich(report)).coverage.find(item=>item.provider === 'Bitquery').state,'available');
  assert.equal(calls,1);
  clock=Date.parse(expiry);
  assert.equal((await service.enrich(report)).coverage.find(item=>item.provider === 'Bitquery').state,'unconfigured');
  assert.equal(calls,1);
});
test('Solana: non-Pump.fun token resolves creator authority via Helius DAS and analyzes wallet',async()=>{
  const customCreator = 'WLHv2UAZm6z4KyaaELi5pjdbJh6RESMva1Rnn8pJVVh';
  const service = createCreatorService({
    env: { HELIUS_API_KEY: 'helius-valid-key' },
    usageFile: null,
    fetcher: async (url, options) => {
      if (url.includes('helius-rpc.com')) {
        return response({
          jsonrpc: '2.0',
          id: 'das-creator-lookup',
          result: {
            authorities: [{ address: customCreator, scopes: ['metadata'] }],
            creators: []
          }
        });
      }
      if (url.includes('/balances?')) return response({ totalUsdValue: 250, balances: [{ symbol: 'SOL', balance: 2, usdValue: 250 }] });
      if (url.includes('/balance-at?')) return response({ balance: '1.5' });
      return response({
        data: [{
          timestamp: 1704067200,
          signature: 'sig-swap',
          error: null,
          type: 'SWAP',
          source: 'RAYDIUM',
          balanceChanges: [{ mint, amount: -0.1 }]
        }]
      });
    }
  });
  const r = await service.enrich({ chain: 'solana', address: mint });
  assert.equal(r.creator.address, customCreator);
  assert.equal(r.creator.source, 'Helius');
  assert.equal(r.balances.items[0].balance, 2);
  assert.equal(r.exchangeUsage.swapTransactions, 1);
  assert.ok(r.exchangeUsage.labels.includes('RAYDIUM'));
});
test('Pump.fun: only the create transaction signer is used, never a provider pool address', async () => {
  const walletCalls = [];
  const service = createCreatorService({
    env: { HELIUS_API_KEY: 'helius-key', BITQUERY_ACCESS_TOKEN: 'bitquery-key', BITQUERY_FREE_TRIAL_UNTIL: new Date(Date.now() + 86400000).toISOString() },
    usageFile: null,
    fetcher: async (url, options) => {
      if (url.includes('bitquery')) {
        const query = JSON.parse(options.body).query;
        assert.match(query, /Address:\{is:\"6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P\"\}/);
        assert.doesNotMatch(query, /LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj|MoonCVVNZFSYkqNXP6bxHLPL6QQJiMagDL3qcqUQTrG/);
        if (query.includes('Instructions(')) return response({ data: { Solana: { Instructions: [{ Transaction: { Signer: solWallet, Signature: 'pump-create' }, Block: { Time: '2026-01-01T00:00:00Z' } }] } } });
        if (query.includes('TokenSupplyUpdates')) return response({ data: { Solana: { TokenSupplyUpdates: [] } } });
        return response({ data: { Solana: { DEXTrades: [] } } });
      }
      assert.ok(url.includes('/wallet/' + solWallet + '/'), 'wallet requests must target the verified creator, not the pool');
      assert.ok(!url.includes(poolWallet));
      walletCalls.push(url);
      if (url.includes('/balances?')) return response({ totalUsdValue: 12, balances: [{ symbol: 'SOL', balance: 0.1, usdValue: 12 }] });
      if (url.includes('/balance-at?')) return response({ balance: '0.1' });
      return response({ data: [] });
    }
  });
  const result = await service.enrich({ chain: 'solana', address: pumpMint, creatorAddress: poolWallet });
  assert.equal(result.creator.address, solWallet);
  assert.equal(result.creator.platform, 'pump.fun');
  assert.equal(result.creator.transaction, 'pump-create');
  assert.equal(result.balances.items[0].symbol, 'SOL');
  assert.equal(walletCalls.length, 4);
});
test('Pump.fun: if the create signer cannot be verified, pool/authority fallbacks are withheld', async () => {
  let heliusCalls = 0;
  const service = createCreatorService({
    env: { HELIUS_API_KEY: 'helius-key', BITQUERY_ACCESS_TOKEN: 'bitquery-key', BITQUERY_FREE_TRIAL_UNTIL: new Date(Date.now() + 86400000).toISOString() },
    usageFile: null,
    fetcher: async (url) => {
      if (url.includes('bitquery')) return response({ data: { Solana: { Instructions: [] } } });
      heliusCalls++;
      return response({ result: { authorities: [{ address: poolWallet }] } });
    }
  });
  const result = await service.enrich({ chain: 'solana', address: pumpMint, creatorAddress: poolWallet });
  assert.equal(result.creator, null);
  assert.equal(result.balances, null);
  assert.equal(heliusCalls, 0);
  assert.match(result.coverage.find(item => item.provider === 'Helius').note, /verified Pump.fun creation signer/);
});
