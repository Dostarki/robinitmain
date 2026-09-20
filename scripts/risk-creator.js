const fs = require('fs');
const path = require('path');
const { getAddress } = require('ethers');
const CHAINS = { ethereum:'1', bsc:'56', base:'8453', arbitrum:'42161', optimism:'10', polygon:'137' };
const PUMP = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
const SOL = 'So11111111111111111111111111111111111111112';
// Pump.fun mints conventionally end in `pump`.  This is only used as a
// conservative guard: a matching mint never falls back to metadata authorities
// or a provider-reported "creator", both of which can be an AMM/pool wallet.
const looksLikePumpMint = value => typeof value === 'string' && value.toLowerCase().endsWith('pump');
function addressFor(chain, value) {
  if (typeof value !== 'string') return null;
  if (chain === 'solana') return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value) ? value : null;
  if (!Object.hasOwn(CHAINS,chain)) return null;
  try { return getAddress(value).toLowerCase(); } catch { return null; }
}
const number = value => value != null && value !== '' && typeof value !== 'boolean' && Number.isFinite(Number(value)) ? Number(value) : null;
const text = value => typeof value === 'string' ? value.slice(0,160) : '';

function createCreatorService({ env = process.env, fetcher = fetch, usageFile = path.join(__dirname,'..','data','risk-provider-usage.json'), now = Date.now, pool = null, requestTimeoutMs = 7000 } = {}) {
  const cache = new Map(), inflight = new Map();
  let etherscanQueue = Promise.resolve();
  const usage = { day:'', counts:{} };
  if (usageFile && fs.existsSync(usageFile)) Object.assign(usage,JSON.parse(fs.readFileSync(usageFile,'utf8')));
  const limits = {
    Helius: Number(env.HELIUS_DAILY_LIMIT || 2000),
    Bitquery: Number(env.BITQUERY_DAILY_LIMIT || 1000),
    Etherscan: Number(env.ETHERSCAN_DAILY_LIMIT || 2000)
  };
  function reserve(provider) {
    const day = new Date(now()).toISOString().slice(0,10);
    if (usage.day !== day) { usage.day = day; usage.counts = {}; }
    if ((usage.counts[provider] || 0) >= limits[provider]) throw Error('Daily request budget reached');
    usage.counts[provider] = (usage.counts[provider] || 0) + 1;
    if (usageFile) { fs.mkdirSync(path.dirname(usageFile),{recursive:true}); fs.writeFileSync(usageFile,JSON.stringify(usage),{mode:0o600}); }
  }
  async function request(provider, url, options = {}) {
    reserve(provider);

    // Pool varsa ve bu provider için key varsa → pool'dan key çek
    if (pool) {
      const maxAttempts = Math.min(3, (pool.pools.get(provider) || []).length || 1);
      let lastError;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const entry = pool.getKey(provider);
        if (!entry) break;

        let requestUrl = url;
        let requestOptions = { ...options };

        if (provider === "Etherscan") {
          const parsed = new URL(requestUrl);
          parsed.searchParams.set("apikey", entry.secret);
          requestUrl = parsed.toString();
        } else if (provider === "Helius") {
          const parsed = new URL(requestUrl);
          if (parsed.searchParams.has('api-key') || parsed.hostname === 'mainnet.helius-rpc.com') {
            parsed.searchParams.set('api-key', entry.secret);
            requestUrl = parsed.toString();
          }
          requestOptions = { ...requestOptions, headers: { ...requestOptions.headers, "X-Api-Key": entry.secret } };
        } else if (provider === "Bitquery") {
          requestOptions = { ...requestOptions, headers: { ...requestOptions.headers, Authorization: "Bearer " + entry.secret } };
        }

        let status;
        try {
          const response = await fetcher(requestUrl, { ...requestOptions, redirect: "error", signal: AbortSignal.timeout(requestTimeoutMs) });
          status = response.status;
          if (!response.ok) {
            const errTxt = await response.text().catch(() => '');
            console.error(`[RiskCreator] ${provider} HTTP ${response.status}:`, errTxt);
            throw Error(response.status === 429 ? 'Provider quota reached' : response.status === 403 ? 'Unavailable on this account or network' : 'Provider temporarily unavailable');
          }
          const body = await response.json();
          if (body.errors?.length || body.error || (provider === 'Etherscan' && body.status !== '1' && !/no transactions found/i.test(body.message || ''))) {
            console.error(`[RiskCreator] ${provider} GraphQL error:`, body.errors || body.error);
            throw Error('Query unavailable on this account');
          }
          pool.recordUsage(entry.keyId, true, { status });
          return body;
        } catch (error) {
          console.error(`[RiskCreator] ${provider} caught error:`, error.message);
          pool.recordUsage(entry.keyId, false, { status });
          lastError = error;
          if (attempt + 1 < maxAttempts) {
            continue;
          }
        }
      }
      if (lastError) throw lastError;
      throw Error('Provider quota reached');
    }

    // Fallback: mevcut davranış (env key ile)
    const response = await fetcher(url, { ...options, redirect: "error", signal: AbortSignal.timeout(requestTimeoutMs) });
    if (!response.ok) throw Error(response.status === 429 ? 'Provider quota reached' : response.status === 403 ? 'Unavailable on this account or network' : 'Provider temporarily unavailable');
    const body = await response.json();
    if (body.errors?.length) throw Error('Query unavailable on this account');
    return body;
  }
  function scan(params, scalar = false) {
    const operation = etherscanQueue.catch(()=>{}).then(async()=>{
      const apikey = pool ? '' : env.ETHERSCAN_API_KEY;
      const data = await request('Etherscan','https://api.etherscan.io/v2/api?' + new URLSearchParams({...params,apikey}));
      if (data.status !== '1' && !/no transactions found/i.test(data.message || '')) throw Error('Unavailable on this account or network');
      return scalar ? (typeof data.result === 'string' && /^\d+$/.test(data.result) ? data.result : null) : Array.isArray(data.result) ? data.result : [];
    });
    // Global serial queue: at most two Etherscan requests per second.
    etherscanQueue = operation.catch(()=>{}).then(()=>new Promise(resolve=>setTimeout(resolve,550)));
    return operation;
  }
  const gql = query => {
  // Pool'dan Bitquery key'i al, yoksa env'den devam et
  const token = pool ? '' : env.BITQUERY_ACCESS_TOKEN;
  return request("Bitquery","https://streaming.bitquery.io/graphql",{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer ' + token},body:JSON.stringify({query})});
};
  async function enrich(report) {
    const chain = report.chain, asset = addressFor(chain,report.address);
    if (!asset) throw Error('Invalid asset');
    const key = chain + ':' + asset;
    if (cache.get(key)?.expires > now()) return {...cache.get(key).value,cached:true};
    if (inflight.has(key)) return inflight.get(key);
    const operation = collect({...report,address:asset}).then(value=>{
      const ttl = value?.creator ? 300000 : 15000;
      cache.set(key,{value,expires:now()+ttl});
      while(cache.size > 300) cache.delete(cache.keys().next().value);
      return value;
    }).finally(()=>inflight.delete(key));
    inflight.set(key,operation); return operation;
  }
  async function collect(report) {
    const { chain, address } = report;
    const result = { chain,address,analyzedAt:now(),creator:null,balances:null,balanceHistory:null,movements:null,launches:null,exchangeUsage:null,rugHistory:{percent:null,evaluated:0,note:'Verified historical launch outcomes are not available. A safety score is not a rug probability.'},coverage:[] };
    const status = (provider,state,note) => result.coverage.push({provider,state,note});
    async function run(provider,task) {
      try { await task(); status(provider,'available','Limited sample; not a complete wallet audit.'); }
      catch(error) { status(provider,'unavailable',error.name === 'TimeoutError' || error.name === 'AbortError' ? 'Provider request timed out' : ['Daily request budget reached','Provider quota reached','Unavailable on this account or network','Query unavailable on this account'].includes(error.message) ? error.message : 'Provider temporarily unavailable'); }
    }
    const pumpMint = chain === 'solana' && looksLikePumpMint(address);
    const candidate = addressFor(chain,report.creatorAddress);
    // Do not treat a generic provider field as a Pump.fun deployer.  It can
    // point to a Raydium pool, an LP authority, or token metadata authority.
    if(candidate && !pumpMint) result.creator = {address:candidate,verification:'Provider-reported creator; creation transaction not verified.',source:'GoPlus'};
    if(chain === 'solana') {
      const trial = pool ? pool.hasKeys('Bitquery') : (Boolean(env.BITQUERY_ACCESS_TOKEN) && Date.parse(env.BITQUERY_FREE_TRIAL_UNTIL || '') > now());
      if(trial) await run('Bitquery',async()=>{
        // This deliberately queries only the Pump.fun program and only its
        // token-creation instructions.  Looking for a mint in generic DEX
        // activity is how pool/LP wallets get incorrectly attributed.
        const query = `query { Solana { Instructions(limit:{count:1},orderBy:{ascending:Block_Time},where:{Transaction:{Result:{Success:true}},Instruction:{Accounts:{includes:{Address:{is:"${address}"}}},Program:{Address:{is:"${PUMP}"},Method:{in:["create","create_v2"]}}}}) { Block { Time } Transaction { Signer Signature } Instruction { Program { Name Address Method } } } } }`;
        const creation = (await gql(query)).data?.Solana?.Instructions?.[0];
        const creator = addressFor(chain,creation?.Transaction?.Signer);
        if(!creator) {
          if (pumpMint) status('Creator','unavailable','No verified Pump.fun create transaction was found; pool and authority wallets are intentionally excluded.');
          else status('Creator','unavailable','No Pump.fun creation transaction found for this mint.');
          return;
        }
        result.creator = {address:creator,source:'Bitquery',platform:'pump.fun',verification:'Verified Pump.fun create transaction signer (the wallet that submitted token creation).',transaction:text(creation.Transaction.Signature),createdAt:text(creation.Block?.Time)};
        const launches = await gql(`query { Solana { TokenSupplyUpdates(limit:{count:20},orderBy:{descending:Block_Time},where:{Transaction:{Result:{Success:true},Signer:{is:"${creator}"}},Instruction:{Program:{Address:{is:"${PUMP}"},Method:{in:["create","create_v2"]}}}}) { Block { Time } TokenSupplyUpdate { Currency { Symbol Name MintAddress } } Transaction { Signature } } } }`);
        const items = (launches.data?.Solana?.TokenSupplyUpdates || []).map(row=>({address:addressFor(chain,row.TokenSupplyUpdate?.Currency?.MintAddress),name:text(row.TokenSupplyUpdate?.Currency?.Name),symbol:text(row.TokenSupplyUpdate?.Currency?.Symbol),createdAt:text(row.Block?.Time),kind:'Pump.fun token'})).filter(item=>item.address && item.address !== address);
        result.launches = {items:[...new Map(items.map(item=>[item.address,item])).values()],note:'Up to 20 recent Pump.fun creation events; current token excluded. Not all launch platforms.'};
        const trades = await gql(`query { Solana { DEXTrades(limit:{count:30},orderBy:{descending:Block_Time},where:{Transaction:{Result:{Success:true},Signer:{is:"${creator}"}}}) { Transaction { Signature } Trade { Dex { ProtocolName } } } } }`);
        const rows = trades.data?.Solana?.DEXTrades || [];
        result.exchangeUsage = {swapTransactions:new Set(rows.map(row=>row.Transaction?.Signature).filter(Boolean)).size,cexTransfers:null,labels:[...new Set(rows.map(row=>text(row.Trade?.Dex?.ProtocolName)).filter(Boolean))],note:'Up to 30 recent DEX trade rows by transaction signer, within the provider retention window. CEX usage is not covered.'};
      }); else status('Bitquery','unconfigured',env.BITQUERY_ACCESS_TOKEN ? 'Free trial is expired or its end date is not configured.' : 'Creator launch history is not connected.');

      let heliusKey = pool ? (pool.hasKeys('Helius') ? 'pooled' : null) : env.HELIUS_API_KEY;
      if (heliusKey && env.BITQUERY_ACCESS_TOKEN && heliusKey === env.BITQUERY_ACCESS_TOKEN) heliusKey = null;

      if (!heliusKey) {
        if (env.HELIUS_API_KEY && env.BITQUERY_ACCESS_TOKEN && env.HELIUS_API_KEY === env.BITQUERY_ACCESS_TOKEN) {
          status('Helius','unconfigured','A separate Helius API key is required; the Bitquery token cannot be reused.');
        } else {
          status('Helius','unconfigured','Wallet data is not connected.');
        }
      } else {
        // Metadata authorities are useful for ordinary SPL tokens, but are not
        // ownership evidence for Pump.fun mints.  A pool/LP wallet must never
        // be rendered as their deployer or used for wallet holdings.
        if (!result.creator && !pumpMint) {
          try {
            const dasData = await request('Helius', `https://mainnet.helius-rpc.com/?api-key=${heliusKey}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ jsonrpc: '2.0', id: 'das-creator-lookup', method: 'getAsset', params: { id: address } }),
              signal: AbortSignal.timeout(6000)
            });
            if (dasData.result) {
              const asset = dasData.result;
              const feeAuth = addressFor('solana', asset?.mint_extensions?.transfer_fee_config?.transfer_fee_config_authority || asset?.mint_extensions?.transfer_fee_config?.withdraw_withheld_authority);
              const creator = addressFor('solana', asset?.creators?.find(c => addressFor('solana', c.address))?.address);
              const authority = addressFor('solana', asset?.authorities?.find(a => addressFor('solana', a.address))?.address);
              const found = creator || feeAuth || authority;
              if (found) {
                result.creator = {
                  address: found,
                  source: 'Helius',
                  verification: creator
                    ? 'Verified creator via Helius on-chain asset data.'
                    : feeAuth
                    ? 'Token fee authority identified via on-chain asset data.'
                    : 'Token authority identified via Helius on-chain data (SPL/Token-2022).'
                };
                status('Creator', 'available', 'Token authority identified via Helius on-chain asset data.');
              }
            }
          } catch {}
        }

        if (!result.creator && pumpMint) {
          try {
            const sigData = await request('Helius', `https://mainnet.helius-rpc.com/?api-key=${heliusKey}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ jsonrpc: '2.0', id: 'pump-create-lookup', method: 'getSignaturesForAddress', params: [address, { limit: 100 }] }),
              signal: AbortSignal.timeout(6000)
            });
            const sigs = sigData.result || [];
            if (sigs.length > 0) {
              const oldest = sigs[sigs.length - 1];
              const txData = await request('Helius', `https://api.helius.xyz/v0/transactions/?api-key=${heliusKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ transactions: [oldest.signature] }),
                signal: AbortSignal.timeout(6000)
              });
              const creator = addressFor('solana', txData?.[0]?.feePayer);
              if (creator) {
                result.creator = {
                  address: creator,
                  source: 'Helius',
                  platform: 'pump.fun',
                  verification: 'Verified Pump.fun token creation submitter (transaction feePayer).',
                  transaction: text(oldest.signature),
                  createdAt: oldest.blockTime ? new Date(oldest.blockTime * 1000).toISOString() : null
                };
                status('Creator', 'available', 'Verified Pump.fun creator via on-chain creation transaction.');
              }
            }
          } catch {}
        }

        if (!result.creator) {
          status('Helius', 'unavailable', pumpMint ? 'A verified Pump.fun creation signer is required before deployer wallet analysis.' : 'A creator address is required before wallet analysis.');
        } else {
          await run('Helius', async () => {
            const wallet = result.creator.address;
            const options = { headers: { 'X-Api-Key': heliusKey } };
            const tasks = await Promise.allSettled([
              request('Helius', `https://api.helius.xyz/v1/wallet/${wallet}/balances?limit=20`, options).then(data => {
                result.balances = { totalUsd: number(data.totalUsdValue), items: (data.balances || []).slice(0, 20).map(item => ({ symbol: text(item.symbol || item.name), balance: number(item.balance), usd: number(item.usdValue) })), note: 'Current holdings; first page of up to 20 assets.' };
              }),
              request('Helius', `https://api.helius.xyz/v1/wallet/${wallet}/history?limit=30`, options).then(data => {
                const rows = (data.data || []).filter(row => !row.error);
                result.movements = { items: rows.flatMap(row => (row.balanceChanges || []).filter(change => change.mint === SOL || change.mint === 'So11111111111111111111111111111111111111111' || change.mint === '11111111111111111111111111111111').map(change => ({ time: new Date(Number(row.timestamp) * 1000).toISOString(), amount: number(change.amount), symbol: 'SOL', transaction: text(row.signature) }))).slice(0, 12), note: 'Native SOL changes within up to 30 recent transactions, not historical wallet balances.' };
                if (!result.exchangeUsage && rows.length > 0) {
                  const swapSignatures = new Set();
                  const dexLabels = new Set();
                  for (const row of rows) {
                    if (row.type === 'SWAP' || row.source === 'RAYDIUM' || row.source === 'ORCA' || row.source === 'JUPITER' || row.source === 'PUMP_FUN') {
                      if (row.signature) swapSignatures.add(row.signature);
                      if (row.source) dexLabels.add(row.source);
                    }
                  }
                  if (swapSignatures.size > 0) {
                    result.exchangeUsage = {
                      swapTransactions: swapSignatures.size,
                      cexTransfers: null,
                      labels: [...dexLabels],
                      note: 'DEX activity observed from recent creator transactions via Helius.'
                    };
                  }
                }
              }),
              ...[7, 1].map(days => {
                const time = Math.floor((now() - days * 86400000) / 1000);
                return request('Helius', `https://api.helius.xyz/v1/wallet/${wallet}/balance-at?mint=So11111111111111111111111111111111111111111&time=${time}`, options).then(data => {
                  const balance = number(data.balance);
                  return balance == null ? null : { time: new Date(time * 1000).toISOString(), balance, symbol: 'SOL' };
                });
              }).map(p => p.then(item => { if (item) (result.balanceHistory ||= { items: [], note: 'Historical native SOL balance snapshots at ~7d and ~24h intervals.' }).items.push(item); }))
            ]);
            if (result.balanceHistory?.items) result.balanceHistory.items.sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
            if (tasks.some(task => task.status === 'rejected')) throw tasks.find(task => task.status === 'rejected').reason;
          });
        }
      }
    } else {
      const chainid = CHAINS[chain];
      if(pool ? !pool.hasKeys('Etherscan') : !env.ETHERSCAN_API_KEY) status('Etherscan','unconfigured','Creator verification is not connected.');
      else await run('Etherscan',async()=>{
        const creation = (await scan({chainid,module:'contract',action:'getcontractcreation',contractaddresses:address}))[0];
        const creator = addressFor(chain,creation?.contractCreator);
        if(!creator) throw Error('Provider temporarily unavailable');
        result.creator = {address:creator,source:'Etherscan',verification:'Contract creation address; may be a factory, not the project operator.',transaction:text(creation.txHash),createdAt:creation.timestamp ? new Date(Number(creation.timestamp)*1000).toISOString() : null};
        const rows = await scan({chainid,module:'account',action:'txlist',address:creator,page:'1',offset:'50',sort:'desc'});
        const items = rows.filter(row=>row.isError === '0' && row.from?.toLowerCase() === creator && addressFor(chain,row.contractAddress) && row.contractAddress.toLowerCase() !== address).map(row=>({address:addressFor(chain,row.contractAddress),name:'Contract deployment',symbol:null,kind:'Unverified contract',createdAt:new Date(Number(row.timeStamp)*1000).toISOString()}));
        result.launches = {items:[...new Map(items.map(item=>[item.address,item])).values()].slice(0,20),note:'Direct creations in the latest 50 normal transactions. Contracts are not necessarily tokens; factory/internal creations are not covered.'};
        const symbol = chain === 'bsc' ? 'BNB' : chain === 'polygon' ? 'POL' : 'ETH';
        result.movements = {items:rows.filter(row=>row.isError === '0' && /^\d+$/.test(row.value || '') && BigInt(row.value) > 0n).map(row=>{
          const outgoing = row.from?.toLowerCase() === creator, incoming = row.to?.toLowerCase() === creator;
          return {time:new Date(Number(row.timeStamp)*1000).toISOString(),amount:outgoing === incoming ? 0 : (outgoing ? -1 : 1)*Number(row.value)/1e18,symbol,transaction:text(row.hash)};
        }).slice(0,12),note:'Native movements in the latest 50 normal transactions. Excludes gas, internal transfers and token transfers; not a balance timeline.'};
        const wei = await scan({chainid,module:'account',action:'balance',address:creator,tag:'latest'},true);
        if(wei == null) throw Error('Provider temporarily unavailable');
        result.balances = {totalUsd:null,items:[{symbol,balance:Number(wei)/1e18,usd:null}],note:'Current native balance on the selected network. Other token holdings are not included.'};

      });

    }
    return result;
  }
  return {enrich, usageSnapshot: () => Object.entries(limits).map(([provider, limit]) => ({ provider, limit, used: usage.day === new Date(now()).toISOString().slice(0,10) ? usage.counts[provider] || 0 : 0, day: new Date(now()).toISOString().slice(0,10) }))};
}
module.exports = { createCreatorService, addressFor };
