# Changelog

All notable changes to Arcora are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the project follows [Semantic Versioning](https://semver.org/) for the published `@arcora/*` npm packages.

## [1.0.1] — 2026-04-29

Hotfix release. Live EURC↔USDC swap payments reverted on-chain with `InsufficientOutput(999_999, 1_000_000)`; the gateway's linear `_estimateAmountIn` fell one wei short of the actual `OracleAMM.calculateSwap` output, and the customer-supplied `maxAmountIn` couldn't compensate because `pay()` sized the swap from the gateway's own estimate. The hosted checkout reported `Paid ✓` for these reverted txs, masking the failure until the indexer left the rows at `created`.

### Fixed
- **Gateway v0.5** (`0xf9537ab0934105966dce1ebfe9e9725e22cd82c0`) — `_estimateAmountIn` now seeds with the linear ceiling estimate, then walks forward 1 wei at a time (cap 8 steps) until `pool.calculateSwap >= amountOut`. Bounded so a degenerate pool can never freeze `pay()`. Regression test (`ShortByOnePool`) covers the 1-wei case explicitly. Deploy tx: `0xe9a79b551d312a1874c892bd91691399fd8510ac2806417cf79077134a6437a3`.
- **`PayButton`** now reads `receipt.status` from `waitForTransactionReceipt` and throws on `"reverted"`. Previously the UI flipped to `Paid ✓` on any included tx, including reverts.
- **`PayButton`** pre-reads the ERC-20 allowance and skips `approve()` if it's already sufficient, so a retry after a failed `pay()` doesn't re-prompt approve. Adds an explicit `"Awaiting payment confirmation…"` state between approve receipt and the second wallet popup so the user knows two prompts are coming.
- **`QuoteDisplay`** widens the customer-side EURC cushion from `+1%` to `+2% + 1000 wei` to absorb the forward/reverse-swap rounding gap. (Belt and braces — the on-chain fix above is the actual cure; the cushion guards against future quote-engine drift.)

### Operational
- v0.4 deprecated and recorded as such in `packages/contracts/deployments/arc-testnet.json`. Existing v0.4 invoices in the DB stay as-is; the indexer/webhook daemons now point exclusively at v0.5 (Vercel envs + VPS `arcora-indexer.service` `.env` updated and the daemon restarted).
- npm packages (`@arcora/sdk`, `@arcora/sdk-react`) untouched — their source surface didn't change.

[1.0.1]: https://github.com/Kubudak90/arc-fx-gateway/releases/tag/v1.0.1

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
