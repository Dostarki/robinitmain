# API infrastructure review — 2026-09-20

## Configuration observed

- Encrypted vault: no stored keys at review time.
- Server environment: one Helius, one Etherscan, one Bitquery credential. No local monthly budgets configured.
- GoPlus: no environment credentials at review time; public security requests.
- RugCheck and Honeypot.is: public verification endpoints. DexScreener: public market data / logo requests.
- Creator daily request budgets: Helius 60, Bitquery 10, Etherscan 100 across all keys. These are application limits, not vendor entitlements.
- Historical provider daily file recorded 5 Bitquery and 12 Helius requests for 2026-09-19. It cannot establish per-key billing percentages.

## Findings and implementation

- Selection previously used oldest last-use timestamp rather than request volume. It now selects the eligible key with the fewest observed UTC calendar-month requests, including in-flight reservations; age breaks ties.
- Corrected reversed credential-expiry filtering and side effects in availability checks.
- Environment counters now persist with vault counters in `data/api-keys.json.usage.json`. This separate file contains counters and credential fingerprints, never plaintext credentials. Existing encrypted vault data stays intact.
- Monthly counters reset by UTC month; legacy lifetime counts are retained separately and are not treated as accurate current-month usage.
- Corrected double counting on creator failures. Helius DAS now uses the same selection and accounting path. Exhausted/paused keys do not fall back to environment credentials.
- GoPlus pooled calls now send the selected bearer token. Server-side app credentials can exchange for a token according to the official documentation. Authentication exchanges are excluded from analysis counters.
- Monitoring includes provider filters, per-key local-budget percentage, provider traffic share, success/failure totals, last status, expiry, cooldown, tracking start, and daily creator budgets.
- All monitoring endpoints require an authenticated admin session. Only the owner can change budgets/expiry or manage vault keys. Mutations enforce same-origin checks; responses expose only masked credentials.

## Meaning of percentages

Local budget usage = observed requests this UTC month / configured local monthly request budget.

Traffic share = this key's observed monthly requests / the provider's observed monthly requests.

Neither is a verified provider billing balance. Vendors may charge variable credits, share quotas across keys, or use different billing periods. Unknown budgets display unavailable. Tracking is partial for the initial month and excludes calls made by other applications. Rotation does not increase a provider account's entitlement.

## Verification

24 automated tests cover selection, concurrent reservations, expiration, cooldown, quota exclusion, persistence/reload, month rollover, secret omission, GoPlus headers/failover, creator error counting and existing creator behavior. React production build passes. Local `/admin` responds 200; unauthenticated `/api/admin/api-keys` responds 401. No live provider requests or credential validity probes were made during this review.

## References

- https://docs.gopluslabs.io/reference/getaccesstokenusingpost
- https://docs.gopluslabs.io/reference/tokensecurityusingget_1
