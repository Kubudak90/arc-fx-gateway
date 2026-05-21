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

*Last updated 2026-05-21. Edits go inline; this file is the only
forward-looking planning doc in the repo.*
