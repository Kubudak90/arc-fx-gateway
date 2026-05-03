# Plan 7 — Audit prep (pre-mainnet)

**Status:** spec; ready to execute the static-analysis + scope-doc pieces in parallel
**Author:** Hüseyin + Claude Opus 4.7 (1M context)
**Date:** 2026-05-03
**Depends on:** v0.8.1 contract set
**Blocks:** mainnet deployment

---

## Why now

Plan-5 compliance hooks shipped Phase 0 in prod (2026-05-02). With the regulatory bar in place, the next pre-mainnet bar is the security audit. Audit firm calendars are 6–12 weeks out — booking lead time exceeds the actual code review duration, so spec'ing this now and locking the engagement is the long-pole item, not the report itself.

Two parallel tracks:
1. **Static analysis CI gate** (Slither already in CI; add Mythril, lock down triage policy). Catches the cheap stuff before the firm sees it.
2. **External firm review.** We pay for someone independent to read the code. Output: report + remediation cycle + final attestation.

---

## Audit scope — what's in, what's out

### IN scope (canonical v0.8.1 production set)

```
packages/contracts/src/
  ArcFXGatewayV8.sol         ← canonical merchant gateway (relayer-driven)
  libraries/                 ← only files imported by V8
  testnet/MintableERC20.sol  ← only if deployed alongside the audit's mainnet plan
```

**Why V8 only**: that's what's deployed at `0x6fAaD9…507a8`. v0.6 (`ArcFXGateway`), v0.7 refactor (`ArcFXGateway` + `StablePool` + `StablecoinRegistry`), and the legacy `OracleAMM` are all production-deprecated as of the StableFX integration (Plan 6).

### OUT of scope (deprecated, do not audit)

| File | Reason out |
|---|---|
| `ArcFXGateway.sol` (v0.6/v0.7) | Replaced by V8; no new traffic since v0.8 cutover |
| `pool/StablePool.sol` + `StableSwap.sol` + `LPToken.sol` + `OracleAMM.sol` + `SwapUtils.sol` + `MathUtils.sol` + `AmplificationUtils.sol` | In-house pool path replaced by Circle App Kit Swap; not on-chain in canonical flow |
| `registry/StablecoinRegistry.sol` + `IStablecoinRegistry.sol` | Tied to the pool path; V8 uses internal `supportedTokens` mapping |
| `libraries/PriceGuard.sol` | Pool oracle path; V8 doesn't price internally |
| `testnet/MockChainlinkFeed.sol` | Testnet harness only; not deployed to mainnet |

**Recommendation:** before audit kickoff, **delete or move** the OUT-of-scope files to `packages/contracts/legacy/`. Auditors charge per LOC; paying for review of dead code is wasteful, and a clean tree avoids "what's this for?" questions during kickoff.

### Adjacent infrastructure (separate review track, not part of the on-chain audit)

- `ops/relayer/run.ts` — drains the Permit2 queue, runs `kit.swap`, calls `settleInvoice`. Holds a hot wallet. Off-chain code; review by an ops/web2 security firm or a senior internal engineer, not the Solidity auditor.
- `packages/app/lib/compliance/` — Plan-5 screening logic. Same — separate web2 review, not Solidity audit.

---

## Static analysis gate

### Already shipping
- **Slither**: `crytic/slither-action@v0.4.0`, `fail-on: medium`, runs on every push/PR touching `packages/contracts/`. Filter `lib/|test/`.

### Add now
- **Mythril**: deeper symbolic analysis. Runs nightly (it's slow; 5–15 min per contract). Same fail threshold.
- **solhint** (optional, lint-grade): catches NatSpec gaps, uninitialised state, ordering. Helpful before the audit firm flags it.
- **Triage file**: `packages/contracts/.slither-triage.md` with documented exceptions + reason codes. Each Slither finding either gets fixed or gets an entry. New findings without an entry fail CI.

### Coverage gate
`forge coverage --report summary` already runs but doesn't fail the build. Add a threshold:
- Lines: ≥ 95%
- Branches: ≥ 90%

V0.8.1 currently sits at ~99 contract tests + fuzz/invariant; gates likely already pass but the failure path matters for regressions.

---

## Pre-audit checklist (handoff package for the firm)

Before kickoff email goes out:

1. **README in audit scope dir** — one page: "what this contract does, who pays who, what an attacker would aim at, what the trust boundary is." Auditors love this; it shaves a day off ramp-up.
2. **NatSpec coverage** — every external + public function has `@notice`, `@param`, `@return`, `@dev` for non-obvious bits. Run `solhint` to find gaps.
3. **Threat model document** — `docs/audit/threat-model.md`. Sections: actors (merchant, customer, relayer, owner), assets (USDC/EURC/whitelisted stables, accrued fees, invoices), attack surface (relayer key compromise, owner key compromise, signature forgery, replay, swap-failure refund branch), mitigations + known assumptions.
4. **Deployment & upgrade story** — V8 is non-upgradeable. Document the upgrade path (deploy new + repoint clients), the role separation (DEFAULT_ADMIN vs RELAYER), and the role rotation procedure.
5. **Test coverage report** — generate `lcov` + a summary table per file.
6. **Known issues list** — anything we already know is suboptimal but accepted (e.g. relayer single-point-of-failure pre-rolling-release). Putting this in writing prevents the firm from re-discovering.
7. **Public facing docs** — link to the v0.8.1 brief, plan-5/6, the live deployment, the dashboard. Auditors read the surface to spot mismatches between spec and implementation.

---

## Firm shortlist

Pick one of these tracks. Each row: typical scope, lead time, ballpark for a contract set our size (~400 LOC core + tests).

| Firm | Track | Lead time | Ballpark | Notes |
|---|---|---|---|---|
| **OpenZeppelin** | Premium / brand-name | 8–12 wk | $40–80k | Strong on access control, OZ-import-heavy code (we use a lot of OZ). |
| **Trail of Bits** | Premium / deep dive | 8–12 wk | $50–120k | Best-in-class but expensive; overkill for our size. |
| **Spearbit** | Senior-led, smaller team | 4–8 wk | $25–60k | Cadre model; good signal-to-noise for V8-sized scope. |
| **Cantina** | Spearbit's contest+private hybrid | 4–6 wk | $20–50k | Newer, but several Circle-adjacent jobs in their portfolio. |
| **Sherlock** | Contest + insurance | 2–4 wk | $20–40k | Time-boxed; coverage layer is genuinely useful as a signal to merchants. |
| **Code4rena** | Pure contest | 1–3 wk | $25–50k | Crowd-sourced; high finding volume, lower average severity, deduplication overhead. |

**Recommended path for v1 mainnet**: Spearbit or Cantina for the primary review (private, senior-led, fast). Optionally chase with a Sherlock contest before mainnet to layer in crowd review. Skip OpenZeppelin/Trail unless we land a high-profile partner who asks for the brand name.

---

## Timeline (mainnet T-0 work-back)

```
T-12 wk : Plan-7 spec frozen. RFP sent to 3 shortlisted firms.
T-10 wk : Firm selected, contract signed, deposit paid.
T-8  wk : Pre-audit cleanup PR merged. OUT-of-scope code removed,
          NatSpec gaps closed, threat model + handoff doc shipped.
T-6  wk : Audit kickoff. Daily standups week 1, weekly thereafter.
T-3  wk : Draft report received. Remediation PRs merged with auditor.
T-2  wk : Final report. Attestation signed.
T-1  wk : Mainnet deploy dry-run on a fresh clone (sanity).
T-0     : Mainnet deploy. Phase 1 compliance flip. Onboarding starts.
```

If the timeline gets compressed, the bottleneck is **firm calendar availability**, not our code. Lock the engagement first; everything else parallelises.

---

## What this plan does NOT cover

- **Off-chain (relayer / app / SDK) security review** — separate engagement, separate firms (Cure53, Doyensec, NCC). Treat as Plan 8 if/when we get there.
- **Operational runbook** — incident response, key rotation cadence, multisig migration. That's its own document, not an audit prep concern.
- **Bug bounty post-launch** — Immunefi or in-house. Set up after audit clean, before mainnet ramp.

---

## Decisions to settle this week

1. **Which firm?** Recommend kicking off RFPs to Spearbit + Cantina + Sherlock (in that order of preference). Decide based on quotes + first-call vibe.
2. **Budget ceiling?** Spec assumes $30–50k. If the cap is higher, OpenZeppelin/Trail come back into play. If lower, contest-only (Sherlock or Code4rena).
3. **Mainnet target date?** This anchors T-0 and back-calculates everything else. Suggest tying it to "post-audit + Phase 1 compliance flip + first paying merchant signed."

---

## Effort

| Phase | Time |
|---|---|
| Plan-7 spec review + RFP draft | 1 day |
| Mythril CI job + Slither triage policy | 0.5 day |
| Pre-audit cleanup (delete OUT-of-scope, close NatSpec gaps) | 1 day |
| Threat model + handoff README | 1 day |
| Coverage threshold gate + lcov report polish | 0.5 day |
| **Total (our side, before firm engagement)** | **~4 days** |

The audit itself runs on the firm's calendar; our remediation cycle is ~3 days of code work spread across the report-receive → final cycle.
