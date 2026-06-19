# Runbook — v2 chain-agnostic CCTP router (no-custody)

Operator guide for the v2 integration (branch `feat/v2-chain-agnostic-router`).
Covers: what it is, how to turn it on, how to drain v1 and cut over, and what to
watch. The implementation plan is `docs/superpowers/plans/2026-06-18-v2-chain-agnostic-router-integration.md`.

## What changed vs v1

| | v1 (custody) | v2 (this) |
|---|---|---|
| Buyer action | gas-less Permit2 signature / raw CCTP burn to the relayer | `approve(USDC)` + `PaymentEscrow.deposit()` on their chain |
| Custody | relayer hot wallet holds funds mid-flight | **none** — funds escrowed on-chain, keeper only relays |
| Destination | Arc-only (bridge → swap on Arc) | chain-agnostic: path A (same-chain) / B (cross-chain USDC) / C (cross-chain token) |
| Refund | relayer-driven, on Arc | `PaymentEscrow.refund` / `recoverToBuyer`, self-routed from `escrowId`, on the pay-from chain |
| Contract | `ArcFXGateway` (`0xEaE9…0142`) | `PaymentEscrow` + `SettlementReceiver`, per chain (see `@arcora/router` `chains.ts`) |
| Fee | 0.30% at claim + ~1% swap | 0.30% (`feeBps`) skimmed in USDC at `settle`, on the escrow chain |

Everything is behind `V2_ENABLED`. With the flag off, the v1 path is byte-for-byte
unchanged.

## Deployed contracts (testnet)

| Chain | CCTP domain | PaymentEscrow | SettlementReceiver |
|---|---|---|---|
| Arc Testnet | 26 | `0xd1a0703CB0527A7677742b156Bd19a6E122A1b3C` | `0x49F9131d09A368a0Cb12504Da90BdE2e3720cc6c` |
| Base Sepolia | 6 | `0xEdC7FCcB1eD192b298A0e7221108eA9D5fCd930a` | `0x125a105daF0FFA7D76Eb65c884E9c03E29b99862` |

`feeBps = 30`, `feeRecipient` set per chain. Arc↔Base are cross-wired
(`settlementReceiver` ↔ `trustedEscrow`). Source of truth: `@arcora/router` `chains.ts`.

## Turn it on

1. **Migrate** — apply `packages/app/lib/db/migrations/0022_v2_chain_agnostic_router.sql`
   (additive + idempotent; safe on the live DB, no v1 column touched).
2. **Flags** — set on the app, relayer, and indexer:
   - `V2_ENABLED=1` (server)
   - `NEXT_PUBLIC_V2_ENABLED=1` (client; must be set at build time)
3. **Fund the keeper** — the relayer EOA (`0x29EcFedDF31E4dA4a62b89bADe35b224cE144DAE`)
   needs **gas** on every v2 chain: Arc (USDC is gas) + Base Sepolia (ETH). `settle`
   is permissionless on the contracts, so the keeper needs no on-chain role — only gas.
4. **Merchant payout** — each merchant calls `POST /api/merchant/payout` with
   `{payoutChainId, payoutCurrency, payoutAddress}` (their OWN address; no custody).
5. Restart the relayer (`ops/relayer`) and indexer (`ops/indexer`) — both pick up the
   v2 loops flag-gated.

## The flow (per invoice)

```
POST /api/merchant/payout            merchant sets {chain, currency, own address}
POST /api/invoices                   amount:string + currency + Idempotency-Key → invoiceRef (NO chain tx)
/i/{invoiceRef}                      buyer: pick pay-from chain → approve → PaymentEscrow.deposit()
POST /api/checkout/v2/deposit        verified on-chain → settlement DEPOSITED, invoice paid, path A/B/C fixed
keeper (ops/relayer)                 after refund window → settle()
  A: merchant paid on escrow chain
  B/C: CCTP burn → Iris attestation → SettlementReceiver.receiveAndSettle → merchant paid
       (blacklisted merchant → park → recoverToBuyer → buyer refunded)
indexer (ops/indexer)                backstops Deposited + confirms terminal state from events
```

## Monitoring

- Keeper logs: `{"msg":"v2keeper", ...}` per settle/receive/recover.
- Indexer logs: `{"msg":"v2indexer", ...}` per backstop/reconcile.
- DB: `select state, count(*) from settlements group by state;` — healthy states drain
  toward `SETTLED` / `SETTLED_FALLBACK_USDC` / `REFUNDED` / `RECOVERED_TO_BUYER`.
- Stuck `BURN_SENT` for a long time → Iris attestation delay; check the burn tx on the
  source explorer and the sandbox Iris (`/v2/messages/{domain}?transactionHash=`).
- `PAYOUT_FAILED` rows → a frozen/blacklisted merchant; the keeper auto-runs
  `recoverToBuyer` (→ `RECOVERED_TO_BUYER`, invoice → refunded).

## Drain & cutover (the value-bearing part)

`ArcFXGateway` v1.3.0 (`0xEaE9…0142`) holds **live escrows** with a 7-day refund
window; `relayer_queue` / `crosschain_payments` may hold in-flight rows. Do NOT flip
everyone at once.

**Dual-run, drain-then-retire:**
1. Turn `V2_ENABLED` on → NEW invoices use the v2 path. Existing v1 invoices keep
   their stored gateway/queue and **drain on the OLD path** (the v1 relayer + indexer
   loops are untouched and still run).
2. The indexer watches BOTH the legacy gateway(s) and the v2 contracts during the
   transition.
3. Migration 0022 is additive-only — never `ALTER`/drop a v1 column while v1 rows
   still reference it. `schema.test.ts` stays green.
4. After the 7-day window elapses with **zero pending v1 rows**
   (`select count(*) from relayer_queue where status in ('pending','processing'); `
   and the equivalent for `crosschain_payments`), retire `crosschain-core` + the
   custody relayer worker in a separate cleanup PR.
5. **Never route one invoice through both models.** Idempotency is one chain
   end-to-end: API `Idempotency-Key` → `invoices.idempotency_key` (unique per
   merchant) → on-chain `PaymentEscrow.idemKey`.

## Verified live

Same-chain (Arc) deposit/refund/settle, and full cross-chain Arc→Base Path B
(deposit → settle/burn → Iris ~24s → receiveAndSettle → merchant paid net of the
0.30% fee) were validated by hand on the deployed contracts. The keeper automates
exactly this.

## Rollback

Set `V2_ENABLED=0` everywhere and restart. New invoices revert to v1; any v2
invoices already deposited remain valid on-chain (escrowed funds are not at risk —
they settle or refund per the contract regardless of the app flag), and the keeper
can be re-enabled to finish them.
