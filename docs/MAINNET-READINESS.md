# Mainnet Readiness — evidence-based gap analysis

**Date:** 2026-07-04 · **Branch:** `feat/v2-chain-agnostic-router`

Arcorapay runs today on **Arc Testnet** (chain `5042002`, USDC-as-gas L1).
Mainnet is hard-gated on two external events that have **not** happened:

1. **Arc Network mainnet launch** (Circle-signalled summer-2026 target — Arc's
   timeline, not ours), and
2. the **pre-mainnet checklist** at the bottom of
   [`ROADMAP.md`](ROADMAP.md) (external audit, multisig migration, KYB, Vault
   hardening, real feeds, mainnet manifest, bug bounty, V12 redeploy).

This document audits the *code* for what is env-driven vs. hardcoded, what
exists vs. what is a promise, and what can be closed **now** before Arc mainnet
opens. Every row cites a file. Where the code does not settle a question,
it is marked **unknown** rather than guessed.

> Terminology note: the active gateway is labelled **v1.3.0** in
> `deployments/arc-testnet.json` (`0xEaE914…0142`). The "V13" / "V12" / "V11"
> shorthand elsewhere refers to the same version lineage by address.

---

## Summary table

| # | Item | Status | Evidence | Mainnet blocker? |
|---|---|:---:|---|:---:|
| 1 | Env-driven chain selection | ⚠️ | Chain id `5042002` hardcoded in ~10 app files + agent packages; RPC/gateway env-driven with testnet fallback; `@arcora/router` registry already has mainnet chains but **no Arc mainnet entry**. `wagmi-config.tsx:11`, `client.ts:5`, `agent-commerce-cli/src/constants.ts:10` | Partial (material edits, not a hard gate) |
| 2 | Contracts redeploy | ❌ | Constructor fully parameterized (`Deploy.s.sol:23-37`, fee ≤1000, 7-day windows); pre-deploy self-audit gate exists (`audit/preflight/pre-deploy-audit.sh`) but **external audit is not part of it and has never run**; `deployments/arc-mainnet.json` is a null placeholder | **YES** |
| 3 | Price feed | ✅ | **No `MockChainlinkFeed`, no on-chain oracle in `ArcFXGateway.sol`.** Cross-currency pricing is off-chain via Circle App Kit `kit.estimateSwap` (`quote-server.ts:122,149`); mainnet uses App Kit mainnet routes — no contract interface to swap. "oracle-refresh timer" **not found in repo** (only cron is `siwe-nonce-cleanup`, `vercel.json:4`) → unknown | No |
| 4 | Compliance gate | ✅ | Noop default; `elliptic` + `trmlabs` adapters already coded; env flip via `COMPLIANCE_PROVIDER` + `COMPLIANCE_REQUIRED` with fail-fast guard (`compliance/factory.ts:23-48`) | No (config flip + API key) |
| 5 | Key management | ❌ | `DEPLOYER_PRIVATE_KEY` still **plaintext** in `packages/contracts/.env:17` (remediation step 5 not done); **no Safe/Gnosis/TimelockController in code** — multisig is docs-only; relayer key Vault AppRole (encrypted at rest, but held in process memory; HSM only *planned*, `vault-signer.ts:27`) | **YES** |
| 6 | CCTP mainnet | ⚠️ | `router/src/chains.ts` has `CCTP_V2_MAINNET` addresses + 6 mainnet chains with real USDC/EURC; **no Arc mainnet entry** (domain/chainId unknown until Circle publishes); IRIS is env/flag-driven, **not** hardcoded to sandbox (`run.ts:80` env, `chains.ts:41-44` flag-selected); mainnet `contracts:{}` empty | Partial (v2 path only) |
| 7 | App/prod config — GATEWAY zero-addr guard | ✅ | **FIXED 2026-07-04** (same day as this audit): `requireGatewayAddress()` in `client.ts` rejects unset/empty/zero; invoices route fails closed with 503 `gateway_unconfigured` before minting. `POOL` still has a silent-zero fallback (`client.ts:24`) — minor residual | No (fixed) |
| 8 | v2 router mainnet impact | ℹ️ | v2 contract **source is not in this repo** (no `PaymentEscrow.sol`/`SettlementReceiver.sol`); only `@arcora/router` TS client + testnet addresses; `V2_ENABLED` off by default. Two divergent mainnet paths — see detail | Informational |
| 9 | Ops / SLO | ⚠️ | Single VPS = SPOF (relayer processes one row at a time, single instance, `run.ts:8`); Vault **sealed on every reboot**, manual 2-of-3 unseal (`ops/vault/README.md`), unseal-key custody fragile (`runbooks/vault-recovery.md`); ntfy single best-effort channel; only a health-check cron | No (deploy) / **YES** (SLO) |
| 10 | SDK / published packages | ⚠️ | `@arcora/sdk` `client.ts:14-16` maps **both** `testnet` and `mainnet` to `https://arcorapay.xyz` (overridable via `baseUrl`); `abi.ts` is the V10 custody ABI; `agent-commerce-cli/constants.ts` hardcodes BASE_URL/RPC/CHAIN_ID/GATEWAY/USDC/server-wallet | Partial (publish-time edits) |

Legend: ✅ ready / env-driven · ⚠️ partial, real work needed · ❌ not done / blocker · ℹ️ informational.

---

## Detail by item

### 1. Env-driven chain selection

**Env-driven (good):**
- Server RPC & gateway read from env with a testnet default:
  `packages/app/lib/chain/client.ts:9` (`ARC_TESTNET_RPC`), `:31-33`
  (`GATEWAY_ADDRESS`).
- Ops daemons read gateway from env: `ops/relayer/run.ts:52`
  (`need("GATEWAY_ADDRESS")`), `ops/indexer/run.ts:18` (env, throws if unset),
  with a `WATCHED_GATEWAYS` allowlist for dual-watch cutovers.
- `@arcora/crosschain-core` (v1 cross-chain) reads the whole chain registry
  from a runtime JSON blob with a non-zero-address validator
  (`crosschain-core/src/chains.ts:46-93`) — no committed addresses.

**Hardcoded (needs manual edit at mainnet):** chain id `5042002` is inlined,
by design ("hardcode with an env-var escape hatch when mainnet ships" —
`components/merchant/MerchantSidebar.tsx:18`), across roughly a dozen sites:

- App: `lib/chain/client.ts:5`, `lib/chain/wagmi-config.tsx:11`,
  `lib/checkout/permit2-verify.ts:21`, `app/quickstart/page.tsx:10`,
  `components/quickstart/AddArcTestnetButton.tsx`,
  `components/merchant/ConnectMerchantButton.tsx:49`,
  `components/merchant/MerchantActivationCard.tsx:32`,
  `components/checkout/PayButton.tsx:59`,
  `components/merchant/RefundButton.tsx:46`. Explorer URL
  `testnet.arcscan.app` is also inlined (`client.ts:11`, `wagmi-config.tsx:17`).
- Agent packages: `agent-commerce-cli/src/constants.ts` (BASE_URL, ARC_RPC,
  CHAIN_ID, GATEWAY, ARC_USDC, SERVER_WALLET — all literals),
  `agent-commerce-core/src/refund.ts:25`.
- `@arcora/router` registry (`router/src/chains.ts`) already ships mainnet
  chains, but **Arc mainnet is not in the list** (only ethereum, avalanche,
  optimism, arbitrum, base, polygon).

**Verdict:** not a hard gate, but a mainnet cutover touches ~12 files across 3
packages plus a new Arc-mainnet registry entry. Consolidating chain config into
one env-driven module now (item A below) would collapse that to one change.

### 2. Contracts

- **Constructor is deploy-ready and parameterized:** `Deploy.s.sol:23-37` reads
  `PROTOCOL_FEE_BPS`, `GATEWAY_OWNER`, `GATEWAY_RELAYER`, `REFUND_WINDOW_SECONDS`,
  `ADMIN_RECOVERY_DELAY`, optional `SUPPORTED_TOKENS` from env;
  `ArcFXGateway.sol:59-77` enforces fee ≤ 1000 bps and non-zero windows and
  grants `DEFAULT_ADMIN_ROLE` / `RELAYER_ROLE`.
- **Live config** (testnet): `protocolFeeBps: 30` (0.30% at claim),
  `refundWindowSeconds: 604800` (7 days), `adminRecoveryDelaySeconds: 604800`
  — `deployments/arc-testnet.json`. Same values carry to mainnet unless changed.
- **Admin surface** (`threat-model.md:35`): `DEFAULT_ADMIN_ROLE` can pause,
  `setTokenSupport`, `withdrawFees(token,to)` (`ArcFXGateway.sol:487`),
  `adminRecoverEscrow`, and manage roles — today a single EOA (see item 5).
- **Pre-deploy gate** (`audit/preflight/pre-deploy-audit.sh`): blocks on
  `forge build` clean + `forge test` green + real coverage floor + **zero new
  medium+ Slither vs. a frozen baseline** + mythril. It is an L1 self-audit that
  *surfaces and blocks*, never broadcasts. Note (`:139-141`): the legacy
  `bin/coverage-gate.sh` still scopes the nonexistent `ArcFXGatewayV10.sol` and
  "passes vacuously" — the preflight works around it with its own guard but
  only warns; repoint it.
- **External audit: NOT-DONE.** No external audit has ever run
  (`ROADMAP.md` "Gated on Arc mainnet" → External audit RFP; `LITEPAPER.md:380`).
  The self-audit gate does **not** substitute for it. `deployments/arc-mainnet.json`
  is an explicit null placeholder (`"_status": "not-yet-deployed"`).
  **RFP drafted 2026-07-05:** `docs/audit/rfp-external-audit.md` — scope, threat
  model, disclosed coverage gaps, shortlist. Pre-audit blocker it surfaces: the
  v2 escrow contracts (`PaymentEscrow`/`SettlementReceiver`) still live in the
  sibling `agent-commerce-v2` repo, not this monorepo — consolidate + tag before
  kickoff.

**Verdict:** deploy mechanics are ready; the **external audit + mainnet redeploy
+ manifest population** are hard blockers.

### 3. Price feed

The task's premise (a `MockChainlinkFeed` + oracle-refresh timer) does **not
match the code**, so flagging honestly:

- **No `MockChainlinkFeed` exists** anywhere outside the vendored
  `lib/chainlink-brownie-contracts` (unused). `ArcFXGateway.sol` has **no oracle,
  no price feed, no `AggregatorV3` reference** — it escrows and settles fixed
  base-unit amounts.
- Cross-currency conversion (e.g. EURC↔USDC, cross-token pay-in) is computed
  **off-chain** by Circle **App Kit** `kit.estimateSwap`
  (`lib/checkout/quote-server.ts:112-149`), with BigInt-only rounding
  (`quoteAmountIn`). On mainnet this automatically uses App Kit's mainnet routes
  and real DEX liquidity — **no contract change, no Chainlink interface to wire.**
- `"oracle-stalled"` appears only as a *refund-reason string* in a test
  (`test/gateway/AuditCoverage.t.sol:109`), not as live oracle logic.
- The **"oracle-refresh timer"** referenced in the task is **not present in this
  repo** — the only registered cron is `siwe-nonce-cleanup` (`vercel.json:4`).
  If such a timer exists it is a VPS systemd unit outside the tree → **unknown**.

**Verdict:** no on-chain feed to replace; mainnet pricing is an App Kit
environment concern, not a code change. (Confirm the App Kit instance is pointed
at mainnet at cutover.)

### 4. Compliance gate

Fully env-flippable, with real adapters already written:
- `compliance/factory.ts:27-48` — `COMPLIANCE_PROVIDER` = `noop | elliptic |
  trmlabs` (default `noop`); `EllipticProvider` and `TRMLabsProvider` are
  implemented (`compliance/elliptic.ts`, `compliance/trmlabs.ts`).
- `complianceRequired()` (`:23`) reads `COMPLIANCE_REQUIRED=true` and **forbids
  the noop provider** (throws at startup) and makes invoice creation fail
  *closed* on RPC/provider error (`invoices/route.ts:266`, AFG-005). A real
  provider with no API key throws `config_required`.

**Verdict:** mainnet flip = set `COMPLIANCE_REQUIRED=true`, `COMPLIANCE_PROVIDER`,
`COMPLIANCE_API_KEY`. No code change. KYB (`ManualKybProvider`/`PersonaProvider`)
for merchant *signup* is a separate roadmap item, not in this code path.

### 5. Key management

- **Deployer/admin key plaintext:** `packages/contracts/.env` holds
  `DEPLOYER_PRIVATE_KEY` in cleartext (gitignored, never in git history — exposure
  is the deploy host, not the repo). **Partly addressed 2026-07-05:**
  `Deploy.s.sol` now reads the key via `vm.envOr(…, 0)` and broadcasts from the
  encrypted Foundry keystore (`--account arcora-deployer`) when it's unset — an
  `arcora-deployer` keystore already exists on the box. Remaining: verify the
  keystore decrypts to `0x26Bf…D8e3`, then scrub the plaintext line. Runbook:
  `docs/runbooks/deployer-key-and-safe.md` Phase A.
- **No multisig / timelock in code.** `grep` finds **no Safe/Gnosis/
  `TimelockController`** anywhere; every "multisig" hit is a *doc* promising the
  migration (`ROADMAP.md:91`, `threat-model.md:119` "Mitigation: multisig
  migration before mainnet"). Admin is a single EOA today. Migration steps
  (grant→verify-from-Safe→revoke-EOA, on Arc's Safe availability) are now
  written up in `docs/runbooks/deployer-key-and-safe.md` Phase B — still needs
  signer devices chosen + the Safe deployed.
- **Relayer key** (`RELAYER_ROLE`): Vault KV-v2 + AppRole, encrypted at rest,
  `secret_id` rotated daily, every read audit-logged — but the key is **held in
  relayer process memory** after fetch (`ops/vault/README.md`, "Audit M1 closure
  scope (partial): ✗ key still lives in process memory"). HSM/KMS isolation is
  *planned* for mainnet T-0 (`vault-signer.ts:27`), not built.
- The historical testnet deployer EOA was de-privileged after a key leak
  (`arc-testnet.json` `deployerNote`) — good hygiene, but the *new* admin key is
  the one now sitting in `.env`.

**Verdict:** **blocker.** Mainnet needs (a) admin key out of plaintext →
hardware/`--account`, (b) `DEFAULT_ADMIN_ROLE` on a 2-of-3/3-of-5 multisig,
(c) relayer key on an HSM signer.

### 6. CCTP mainnet

- **Mainnet address coverage is already coded** in `router/src/chains.ts:180-262`:
  `CCTP_V2_MAINNET` TokenMessenger/MessageTransmitter, plus Ethereum, Avalanche,
  OP, Arbitrum, **Base** (chainId 8453, domain 6), Polygon — each with real
  mainnet USDC/EURC and CCTP domains, sourced from Circle docs.
- **Arc mainnet is absent.** Neither `router` nor `crosschain-core` has an Arc
  mainnet entry — its chainId and CCTP domain are unknown until Circle publishes
  them → **unknown**. Mainnet `contracts:{}` are empty everywhere
  (PaymentEscrow/SettlementReceiver not deployed on any mainnet).
- **IRIS is not hardcoded to sandbox.** The ops relayer reads
  `CCTP_IRIS_API_URL` from env (`run.ts:80`); `@arcora/router` selects
  `IRIS_API.mainnet` vs `.testnet` by a `testnet` flag
  (`router/src/chains.ts:41-44`, `iris.ts:35-36`). Base URLs are the canonical
  `iris-api.circle.com` / `iris-api-sandbox.circle.com`.

**Verdict:** for **Base mainnet + Arc mainnet CCTP**, the code needs: the Arc
mainnet registry row (blocked on Circle's Arc mainnet domain), the deployed v2
contract addresses per mainnet chain, and the env flags flipped to
mainnet/IRIS-prod. This only affects the v2 cross-chain path (item 8).

### 7. App / prod config — the GATEWAY zero-address guard

**Confirmed missing.** `packages/app/lib/chain/client.ts:31-33`:

```ts
export const GATEWAY_ADDRESS: Address =
  (process.env.GATEWAY_ADDRESS
    ?? "0x0000000000000000000000000000000000000000") as Address;
```

If `GATEWAY_ADDRESS` is unset in any Vercel scope, the app silently boots with
the **zero address** and every on-chain read/settle targets `0x000…000` — the
class of failure that caused the recent prod outage. `POOL` has the same
silent-zero fallback (`client.ts:24`). `invoices/route.ts:236` uses `GATEWAY`
directly (`targetGateway = GATEWAY`) with **no non-zero assertion**. There is a
zero-check on the *on-chain merchant struct* (`route.ts:262`) but **not** on the
gateway address itself.

**Verdict:** a **quick win**, independent of mainnet — add a fail-fast guard
(throw at module load / a health-check assertion) so a missing env is loud, not
silent. Size **S**.

> **FIXED 2026-07-04, same day as this audit:** `requireGatewayAddress()` was
> added to `lib/chain/client.ts` and the invoices route now resolves the
> gateway through it, returning 503 `gateway_unconfigured` instead of anchoring
> to the zero address (covered by a regression test in
> `app/api/invoices/route.test.ts`). Residual: `POOL` keeps its silent-zero
> fallback — apply the same pattern if/when a POOL write path ships.

### 8. v2 router — mainnet impact

- The chain-agnostic no-custody router (`PaymentEscrow` + `SettlementReceiver`,
  path A/B/C, CCTP V2, 0.30% fee at settle) is integrated behind `V2_ENABLED`
  and **off by default**; v1 is byte-for-byte unchanged with the flag off
  (`runbooks/v2-chain-agnostic-router.md`).
- **The v2 contract source is not in this repo** — there is no `PaymentEscrow.sol`
  / `SettlementReceiver.sol` under `packages/contracts/src` (only `ArcFXGateway.sol`
  and a testnet `MintableERC20`). What ships here is the **TS client**
  `@arcora/router` (`2.0.0-alpha.0`, publishable) carrying the *testnet* deployed
  addresses (`chains.ts:148-175`). So the v2 spine is effectively a **vendored /
  separate-repo** dependency from this tree's perspective.

**Two mainnet scenarios:**

- **(A) Lift the v1 custody spine to Arc mainnet.** Smaller surface: one chain,
  one audited contract (`ArcFXGateway`), the existing relayer/indexer. Costs:
  external audit of v1, multisig admin, relayer HSM — and it **keeps custody**
  (relayer hot wallet holds funds mid-flight; the D1 "admin/relayer key
  compromise = catastrophic" risk stays). Fastest path to a paying merchant on
  Arc mainnet if Arc opens before v2 is audited.
- **(B) Wait for / ship v2 no-custody.** Removes custody entirely (keeper only
  relays attestations), self-routing refunds, chain-agnostic. Costs: the v2
  contracts must be **sourced into an auditable repo, audited, and deployed on
  each mainnet chain** (Arc + Base + …), plus an **Arc mainnet CCTP domain**
  (unknown, item 6), plus retiring `crosschain-core`. Strictly more work, but
  the right long-term risk posture.

**Recommendation:** don't block Arc mainnet on v2. If Arc opens first, ship (A)
for Arc-only same-chain custody checkout under audit+multisig, keep `V2_ENABLED`
off, and land (B) as the planned migration once the v2 contracts are audited and
Circle publishes Arc mainnet CCTP. The drain-then-retire cutover in the runbook
already supports running both.

### 9. Ops / SLO

- **Single VPS = SPOF.** The relayer drains the queue **one row at a time** to
  keep hot-wallet nonces sane "on a single VPS without coordination machinery"
  (`ops/relayer/run.ts:8`); it is a single instance. Roadmap "Next" lists
  multi-relayer failover as *not yet built*.
- **Vault sealed on every reboot.** Requires manual `vault operator unseal`
  twice with 2-of-3 keys (`ops/vault/install.sh:39`, `ops/vault/README.md`);
  until unsealed, relayer signing and (v2) settlement are down. The
  `runbooks/vault-recovery.md` documents that the original unseal keys were once
  not reliably saved — unseal-key custody is a real operational fragility.
- **Alerting** is a single best-effort ntfy.sh channel (`ops/health/README.md`),
  topic-as-secret, no auth, `|| true` (never blocks); driven by one health-check
  cron. No paging, no redundancy.

**Verdict:** fine for a testnet beta; **below a money-moving SLO.** Not a
deploy-blocker, but multi-instance relayer, auto-unseal (or HA Vault), and real
paging are prerequisites for a mainnet uptime commitment.

### 10. SDK / published packages

- `@arcora/sdk` (`1.4.0`, public): `client.ts:14-16` maps **both** `testnet` and
  `mainnet` environments to `https://arcorapay.xyz` (there is no separate mainnet
  host yet); overridable per-call via `opts.baseUrl` (`:28-29`). `abi.ts` is the
  **V10 custody ABI** (generated from `ArcFXGatewayV10`), so an ABI-breaking
  mainnet redeploy requires regenerating + republishing. Chain id `5042002`
  appears only in doc comments (`permit2.ts:44`).
- `@arcora/agent-commerce` (`0.1.3`, public): `src/constants.ts` hardcodes
  `BASE_URL`, `ARC_RPC`, `CHAIN_ID`, `GATEWAY`, `ARC_USDC`, `SERVER_WALLET`,
  `FAUCET_URL` — a mainnet build is a source edit + republish.
- `@arcora/router` (`2.0.0-alpha.0`, public) and `@arcora/crosschain-core`
  (`private`) — the former is the v2 client discussed above.

**Verdict:** no hard blocker, but the published-package cutover to mainnet is a
coordinated **edit + version bump + republish** across sdk / sdk-react /
agent-commerce, and the sdk `mainnet` base-URL/ABI need to become real.

---

## Do NOW — before Arc mainnet opens (priority-ordered, S/M/L)

1. ~~**[S] Add a fail-fast guard for `GATEWAY_ADDRESS`**~~ **DONE 2026-07-04**
   — `requireGatewayAddress()` + 503 fail-closed in the invoices route, with a
   regression test. Residual: apply the same pattern to `POOL` if a POOL write
   path ships.
2. **[S] Delete `DEPLOYER_PRIVATE_KEY` from `packages/contracts/.env`** and move
   to `forge --account` / a hardware key (finish remediation Step 5). Removes a
   live plaintext admin key today.
3. ~~**[S] Repoint `bin/coverage-gate.sh`**~~ **ALREADY DONE 2026-06-17** — the
   active `in_scope` pattern targets `src/ArcFXGateway.sol` (the V10 reference at
   `pre-deploy-audit.sh:139-141` is an advisory grep for regressions plus a
   historical comment, not a live bug).
4. **[M] Kick off the external audit RFP** (Spearbit / Cantina / Sherlock) for
   `ArcFXGateway.sol` — longest lead-time item and a hard gate; start now against
   frozen source. *(NOT-DONE.)*
5. **[M] Stand up the admin multisig** (Safe 2-of-3 / 3-of-5) and rehearse the
   `DEFAULT_ADMIN_ROLE` transfer on testnet — no multisig exists in code yet.
6. **[M] Consolidate chain config into one env-driven module** and add the Arc
   *mainnet* registry rows to `@arcora/router` / `crosschain-core` (leave CCTP
   domain as a TODO pending Circle) — collapses the ~12 hardcoded `5042002` sites
   (item 1) into one switch.
7. **[M] Wire compliance for go-live**: obtain the Elliptic/TRM API key, test
   `COMPLIANCE_PROVIDER=elliptic|trmlabs` + `COMPLIANCE_REQUIRED=true` end-to-end
   on testnet (adapters already coded — this is validation, not build).
8. **[M] Ops hardening for SLO**: multi-instance/failover relayer design, Vault
   auto-unseal (or HA) so a reboot doesn't halt settlement, and real paging
   alongside ntfy.
9. **[L] Source the v2 contracts (`PaymentEscrow`/`SettlementReceiver`) into an
   auditable location** and add them to the audit scope — precondition for the
   no-custody mainnet path (scenario 8-B); can proceed before Arc mainnet CCTP is
   published.
10. **[S] Make the SDK `mainnet` environment real** (distinct base URL slot +
    a plan to regenerate the mainnet gateway ABI) so `@arcora/sdk` /
    `@arcora/agent-commerce` publish cleanly at cutover.

*Blocked on Circle (cannot start now):* Arc mainnet chainId + CCTP domain, Arc
mainnet USDC/EURC addresses, populating `deployments/arc-mainnet.json`, and any
mainnet contract deploy — all gated on Arc Network mainnet itself.
