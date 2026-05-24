# Arcora Roadmap

The forward-looking work for this repo. All prior plans (Plans 1 – 10, the
2026-05-18 redesign, the 2026-05-19 audit-fix sweep, the 2026-05-20 V10
retirement) shipped and are now in git history only — they are not tracked
as live documents.

The multi-stable track (USDT / PYUSD / DAI / USDe on testnet) has moved to
a separate project and is no longer part of this repo's plan.

---

## Operational hygiene

Small bits left over from the 2026-05-20 cutover. Each is a single
command or a small ops touch, but it should happen.

- **Rotate the Supabase DB password.** Both the old Neon password and the
  current Supabase password ended up in the 2026-05-20 session transcript
  through transcript-redaction misses. Vercel Dashboard → Storage →
  `arc-fx-db` → "Sync env vars" rotates the value and re-syncs every
  scope automatically. After rotation, mirror the new
  `POSTGRES_URL_NON_POOLING` to the three VPS daemons (`/root/arcora-ops/
  {indexer,relayer,webhooks}/.env`) and restart them.
- **Delete the retired Neon project.** Disconnected from Vercel on
  2026-05-20 but the DB is still attached to the Neon account. After the
  Neon free-tier compute quota resets (monthly), pull a final pg_dump for
  the archive and run `vercel integration-resource remove
  neon-erin-umbrella --yes`.
- **Clean the `.bak-*` env backups on the VPS.** Several backup files
  under `/root/arcora-ops/{indexer,relayer,webhooks}/` carry the old Neon
  password as a plaintext literal. Once the Supabase rotation above is
  done they have no operational value and should be removed.

---

## V12 contracts — design carry from 2026-05-24 audit

The 2026-05-24 audit's smart-contract pass found nothing exploitable on
the deployed V11 bytecode, but it surfaced nine items that all need
contract-source changes — i.e. they can't ship without a redeploy. None
individually justify an emergency V12; they're collected here so the
next planned redeploy (with multi-stable, with mainnet, or with a
deliberate hardening cycle) carries them as a unit.

The two off-chain commits that mitigate the contract-level risks until
V12 lands are already in (the rest of the audit follow-up below):
- The relayer's persist-before-await for refund (Ops-H2) makes the
  customer-payout side of the contracts' refund flow recoverable
  regardless of any contract-side issue.
- The admin-recovery edge in the contracts H-1 finding requires admin
  action to weaponise, which today's single-EOA `DEFAULT_ADMIN_ROLE`
  already exposes — the pre-mainnet multisig migration on the checklist
  below closes the same blast radius from a different angle.

### V12 items

| Sev | Item | Where | Why it needs V12 |
|---|---|---|---|
| H-1 | `adminRecoverEscrow` reads current `merchants[m].active` instead of the merchant's deactivation epoch — a reactivate→deactivate cycle lets admin sweep old escrows. | `ArcFXGateway.sol:409` | Needs `uint64 deactivatedAt` on the merchant struct + guard `escrow.claimableAt >= merchants[m].deactivatedAt`. |
| M-1 | `claim()` and `adminRecoverEscrow()` are not `whenNotPaused`. Tests treat this as intentional; either it is (and needs NatSpec) or it isn't (and needs the guard). | `ArcFXGateway.sol:358, 409` | Either decision is a source edit. |
| M-2 | Delegate-expiry boundary inconsistent: `createInvoiceFor` uses `<`, `refundInvoice` uses `>=`. Standardize on `>` ("expires after this block"). | `ArcFXGateway.sol:195, refund path` | One-line semantic change in each branch. |
| L-1 | `protocolFeesAccrued` conflates relayer-submitted swap surplus with actual fees — withdrawable as one bucket, no path to refund a buggy relayer's over-submission. Either split mappings or NatSpec the conflation. | `ArcFXGateway.sol:279, 375` | Storage shape change OR doc change in source. |
| L-2 | `revokeDelegate` emits `DelegateRevoked` for any caller with any target — indexer-log spam, no fund risk. Guard with "delegate exists" or "caller is a registered merchant" check. | `ArcFXGateway.sol:234-237` | One-line guard. |
| L-3 | `claim()` reads `inv.merchant` from the storage pointer after the external `safeTransfer`. Currently safe (no field mutation in between) but the pattern would silently break a future edit. Cache `address merchant_ = inv.merchant` before the transfer. | `ArcFXGateway.sol:373-379` | One-line CEI nit. |
| I-1 | `authorizeDelegate` has no upper bound on `expiresAt` — type(uint64).max creates an effectively permanent delegation. Add a `MAX_DELEGATE_WINDOW` constant + guard. | `ArcFXGateway.sol:226-231` | New constant + one revert. |
| I-2 | `_createInvoice` accepts `expiresAt = 0` / past — invoice is immediately uncollectable. One-line `if (expiresAt <= block.timestamp) revert InvalidExpiry()`. | `ArcFXGateway.sol:200-224` | Trivial guard. |
| I-3 | `MintableERC20` testnet faucet has no mint cap. Not a production contract today, but the file would be unsafe to copy as a stub for any mainnet wrapped-stable. Add an inline "TESTNET ONLY — DO NOT COPY" header. | `MintableERC20.sol:23` | Comment only. |

### V12 cut criteria

Trigger one of:
- Multi-stable expansion (USDT / PYUSD / DAI / USDe). Adds a contract
  axis already, V12 fixes ride along.
- Mainnet T-0 cutover. Pairs naturally with the multisig migration on
  the pre-mainnet checklist below.
- A new High/Critical finding in a later audit that needs source-level
  work anyway.

Until then, V11 stays live and the off-chain fixes above are the
mitigation surface.

---

## Backlog — audit findings consciously deferred

The 2026-05-19 audit Low-severity backlog was cleared in the
2026-05-21 sweep (commits 8fa56e2 / a25b184 / c67c6d2 / and the
low-severity-backlog branch — env hygiene, V10/V11 doc cleanup, test
SSL conditional, all six Low items). Two items remain:

- **`pnpm audit` — 11 moderate transitive advisories.** None are in
  direct deps; the chain is wallet-stack-internal (`@metamask/*`,
  `wagmi` connectors, `thirdweb`'s `x402` route, `vite`/`esbuild`
  through dev deps). No known exploit path against our usage. Fix is to
  wait for upstream wagmi / thirdweb minor bumps or add `pnpm.overrides`
  at the workspace root once the bumps are no longer churning.
  Acceptable for testnet; closed at pre-mainnet T-0.
- **Wagmi SSR `indexedDB` warning.** The `lib/chain/wagmi-config.tsx`
  side is correct (`ssr: true` + `noopStorage` on the server). The
  residual warning comes from the WalletConnect / thirdweb client which
  ignores wagmi's `createStorage` abstraction and touches its own
  IndexedDB store at module-eval time. Build still exits clean; static
  pages still generate. Proper fix is to wrap `ChainProviders` in a
  client-only `dynamic({ ssr: false })` boundary, which is a structural
  layout change — folded into the v2.0 redesign work.

---

## Roadmap — what comes after v1.2

The product roadmap captured in `LITEPAPER.md` section 10 is the
canonical source. The summary view:

| Phase | Ships |
|---|---|
| **v2.0** | Crosschain USDC source via Arc App Kit Bridge (Ethereum, Arbitrum, Optimism, Base, Polygon, Avalanche, Linea, Codex). Routes through App Kit Bridge, not raw CCTP. Merchant still settles in their chosen Arc stable. |
| **v2.1** | Source-side aggregator — customer pays in any token on the source chain (native ETH, any ERC-20), via Odos/1inch/0x/Paraswap on each source chain. Reverse route engine computes max-in given target output and slippage. |
| **v2.2** | Non-EVM sources — Solana, Sui. Same product surface, different wallet stack. |
| **v3.0** | Intent / solver model. One-signature one-click; Arcora's solver executes the full route. Multi-month research on ERC-7683, Across, DeBridge-Liquid. Not started until v2.0 and v2.1 are stable. |

### Pre-mainnet checklist

Triggered by Arc Network mainnet launch *or* first paying merchant *or*
funding round close — whichever comes first.

- External audit RFP (Spearbit / Cantina / Sherlock).
- Multisig admin migration: `DEFAULT_ADMIN_ROLE` from single EOA to
  2-of-3 or 3-of-5.
- KYB go-live: `ManualKybProvider` ($0, testnet pattern) + `PersonaProvider`
  (post-revenue) wired into merchant signup.
- Vault hardening: TLS on listener (cert + dedicated host), dedicated
  Unix user for `relayer`/`indexer`/`webhooks`, eventual migration of
  the relayer key to an HSM-isolated signer.
- Real Chainlink price feeds — replace mock feeds per stable; oracle
  keepalive timer becomes obsolete.
- Compliance provider activation — flip `COMPLIANCE_PROVIDER` from
  `noop` to `elliptic` or `trmlabs`.
- Populate `packages/contracts/deployments/arc-mainnet.json` — currently
  a null placeholder with the same shape as `arc-testnet.json`.
- Bug bounty — Immunefi engagement with first paying merchant.

---

*Last updated 2026-05-24. Edits go inline; this file is the only
forward-looking planning doc in the repo.*
