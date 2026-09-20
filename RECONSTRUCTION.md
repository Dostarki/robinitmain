# TEST testnet curve

Baseline: `0xCb596Dd8fc330E7a7da0D3333dBE012a018646Da` on Robinhood Chain.

The explorer exposes compiler metadata (`solc 0.8.7`, optimizer 200) and deployed
bytecode, not a verified Solidity source file. `src/ChronoIndexCurve.sol` is therefore
a readable behaviour reconstruction, not an assertion of source identity. The current
testnet adaptation calls the asset `TEST` and assigns the newly created test wallet as
its sole treasury and administrator.

## Verified economics

| Quantity | Value |
| --- | ---: |
| Tokens offered on curve | 200,000,000 TEST |
| Total stated supply | 1,000,000,000 TEST |
| Starting marginal price | $0.000100 |
| Ending marginal price | $0.000900 |
| Index close | $100,000 |
| Wallet cap | 2 ETH |

`src/TestToken.sol` supplies the fixed 1B TEST token for this testnet-only setup.
Its full supply is minted to the same test wallet; after deployment, exactly 200M TEST
must be transferred to the curve before claims are opened.

With `S = 200,000,000`, `p0 = 0.0001`, `p1 = 0.0009` and sold tokens `q`:

```
p(q) = p0 + (p1 - p0) q / S
I(q) = p0 q + (p1 - p0) q² / (2S)
```

Thus `I(S) = $100,000`. The "Index" is `I`, cumulative accepted USD, rather
than conventional spot market capitalization.

## Intentional differences to audit before use

- Function and event names are readable names inferred from control flow, not names
  recoverable from EVM bytecode.
- The original implementation's exact storage packing, revert strings, selector set,
  rounding edge cases and event topics require bytecode-level differential testing.
- The `buy()` selector is supplied for integrator ergonomics; direct ETH transfer via
  `receive()` is the observed primary buy path.
- No deployment artifact is included. Do not deploy this reconstruction as though it
  were the original contract.
