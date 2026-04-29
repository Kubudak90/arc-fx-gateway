# Changelog

All notable changes to Arcora are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the project follows [Semantic Versioning](https://semver.org/) for the published `@arcora/*` npm packages.

## [1.0.0] — 2026-04-28

First shippable Arcora release. Arc-only stablecoin checkout and FX settlement: merchants take USDC or EURC, customers pay with USDC or EURC, the on-chain gateway swaps and settles atomically.

### Added
- **Arcora Gateway v0.4** at `0xA80A5741a09bff1f43dcBF15Df7c598A23163302` on Arc testnet.
- **`@arcora/sdk`** — three-function checkout client (`init` / `createInvoice` / `openCheckout`), zero EVM deps, ~1.5 KB gzipped.
- **`@arcora/sdk-react`** — `<CheckoutButton />` and `useCheckout()` for drop-in React integration.
- **Hosted checkout app** at `arc-fx-gateway.vercel.app`: SIWE merchant auth, invoice creation via server hot wallet, customer-side wallet connect (MetaMask + WalletConnect), live FX quote display.
- **Merchant dashboard** under `/m/`: invoice list, create new, share QR, API key + webhook URL settings.
- **VPS-resident ops daemons** (`arcora-indexer.service`, `arcora-webhooks.service`) with systemd `Restart=always`, replacing Vercel cron for chain → DB sync and webhook delivery.
- **OracleAMM** Chainlink-priced two-token swap pool for USDC ⇄ EURC, ± 4 bps fee, ± 0.5% deviation guard.
- **Demo merchant** (`packages/demo-merchant/`) wired to `@arcora/sdk` showing a 5-line integration.
- **Arcora brand identity** applied across surfaces: blue `#2563FF`, teal `#00C2A8`, slate `#0B1426`; symbol + wordmark logo; Inter typography.

### Contract surface (v0.4 changes vs earlier dev iterations)
- Namespaced invoice IDs — `globalId = keccak256(merchant, merchantInvoiceId)` so two merchants can reuse the same `merchantInvoiceId`.
- Merchant struct gains `payoutAddress` (separate from `msg.sender`) and an `active` flag; `updatePayoutAddress`, `updatePayoutToken`, `deactivateMerchant` added.
- Same-token branch in `pay()` skips the AMM round-trip when `payInToken == payoutToken`.
- `InvoicePaid` event split into 6 fields: `(globalId, payer, amountIn, grossReceived, merchantPayout, fee)`.
- Each invoice locks its `payoutToken` at creation; later merchant updates do not reroute pending invoices.

### Tests
- Contracts (Foundry): 99 passing — unit + fuzz (10k runs) + invariant (256 × 64) + deploy scripts.
- App (vitest): 42 passing.
- App (Playwright E2E): 5 critical flows passing.
- SDK (vitest): 8 passing.
- `@arcora/sdk-react` (vitest): 3 passing.

### Known limitations
- Single AMM pool (USDC/EURC); other stables (USDT, PYUSD, DAI, regional) deferred to v1.x.
- Single chain (Arc testnet). Crosschain payment from any CCTP-supported chain is the v2.0 milestone.
- Mock Chainlink feed on testnet — a VPS systemd timer keeps it fresh; mainnet replaces this with the real Chainlink EUR/USD feed.

[1.0.0]: https://github.com/Kubudak90/arc-fx-gateway/releases/tag/v1.0.0
