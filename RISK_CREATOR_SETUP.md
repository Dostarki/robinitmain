# Creator intelligence — free / trial integrations

The React risk page loads creator insights separately from the safety assessment. Existing reports, deployments, admin settings and browser history are preserved.

## Setup

Create a `.env` in the repository root using `.env.example` as the template. Configure only server-side credentials. Restart `node scripts/serve-app.js` after changing keys. Never put credentials in `app/`, browser storage or React build variables. `.env` is ignored by Git and is outside the static application root.

| Provider | Configuration | Implemented scope |
| --- | --- | --- |
| Helius | `HELIUS_API_KEY` | Solana current balances (20 assets), recent native balance changes (30 transactions), native SOL snapshots at 1 and 7 days ago |
| Bitquery | `BITQUERY_ACCESS_TOKEN`, `BITQUERY_FREE_TRIAL_UNTIL` | Pump.fun creation signer, up to 20 launches, up to 30 recent DEX trade rows |
| Etherscan V2 | `ETHERSCAN_API_KEY` | Contract creation address, direct deployments and native movements observed in 50 recent normal transactions, current native balance |

Moralis is excluded: current pricing lists paid plans. The adapter was removed, and Moralis credentials are not used, even if present in the environment. EVM balances and normal native movements now use Etherscan. EVM decoded swaps and CEX labels remain unavailable rather than being inferred from transaction recipients.

Bitquery is treated as a **time-limited trial**, not a permanent free tier. Trial durations can differ by account; configure the actual expiry shown in your account as an ISO timestamp with a timezone. Calls stop once expired; there is no arbitrary seven-day maximum. This local check does not extend provider trial access or independently verify the account's billing plan. When only an expiry date is supplied, use the start of that date in the account's timezone as a conservative cutoff until its exact time is known. No paid upgrade is attempted.

Etherscan free availability varies by network. A network rejected by the provider is marked unavailable: there is no paid endpoint retry or automatic upgrade. Contract factory addresses are not assumed to be the human creator. Observed contracts are not called ERC-20 tokens without verification.

## Budget and failure behavior

- Fixed external hosts, validated network/address, server-side secrets, 7-second request timeouts.
- Five-minute cache and identical in-flight request deduplication; maximum 300 cached assets.
- Persistent UTC daily **request ceilings** in `data/risk-provider-usage.json`: Helius 60, Bitquery 10, Etherscan 100. These are conservative application budgets, not a guarantee of API compute-unit/point costs. Check account quotas; no unlimited pagination or bulk per-token fan-out.
- Etherscan calls are globally serialized with a 550ms gap, below the free 3 requests/second limit.
- Missing keys, quota limits, expiry, timeouts and partial results appear under Data coverage. No credentials or raw provider errors are returned.
- The endpoint accepts only previously saved token assessments; 20 requests/minute/IP. This local limiter is not production-grade distributed abuse protection.
- No paid Helius identity/funded-by, Moralis entity/insight analytics, Etherscan historical balance endpoint, or paid Bitquery upgrade.

## Interpretation

Current USD holdings from Helius are **sampled page value**, not necessarily the full wallet portfolio. Native balance snapshots do not use historical USD conversions. Etherscan normal transfer movements are not wallet balance timelines and exclude gas, internal transactions and token transfers.

Solana creator resolution covers Pump.fun creation transaction signers; signers can be launch services. Other launch platforms may be unavailable. GoPlus's explicit `creator_address`, when supplied, is labeled provider-reported rather than independently verified. Metadata update authorities and royalty creators are not substituted for the token creator.

DEX counts and CEX labels cover only the returned sample; absent labels do not prove absence of exchange usage. CEX deposits/withdrawals do not reveal trades inside an exchange. Bitquery DEX retention limits apply.

**Rug percentage is intentionally unavailable** without independently verified historical launch outcomes and a defined denominator. Neither 100 minus safety score nor a current high-risk flag is a measured historical rug rate.

## Verification

`node --test scripts/risk-creator.test.js` runs mocked integration/security tests. `npm run build:risk` rebuilds the React frontend. Live provider verification requires valid credentials for each enabled provider; missing credentials do not produce demo data. A Bitquery token must not also be configured as a Helius API key. The token label/API name is not an API credential.

## Official references

- [Helius wallet API tiers](https://www.helius.dev/docs/wallet-api/overview)
- [Helius historical native balance](https://www.helius.dev/docs/api-reference/wallet-api/balance-at)
- [Bitquery Pump.fun creation and launch queries](https://docs.bitquery.io/docs/blockchain/Solana/Pumpfun/Pump-Fun-API/)
- [Bitquery plans](https://docs.bitquery.io/docs/ide/points/)
- [Etherscan creation endpoint](https://docs.etherscan.io/api-reference/endpoint/getcontractcreation)
- [Etherscan rate limits](https://docs.etherscan.io/rate-limits)
- [Moralis wallet history](https://docs.moralis.com/data-api/evm/wallet/wallet-history)
- [Moralis premium endpoint exclusions](https://docs.moralis.com/data-api/introduction/resources/premium-endpoints)
- [Moralis current pricing](https://moralis.com/pricing/)
