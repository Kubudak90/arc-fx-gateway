# Plan 7 — Audit prep (pre-mainnet)

**Status:** spec; ready to execute. **Budget reality (2026-05-03):** zero. Strategy is "self-audit to the maximum, defer paid review until first real revenue, set up bug bounty as the live shield." See "Zero-budget path" section below — that is the canonical strategy until funds arrive. Paid-firm sections kept for future reference.
**Author:** Hüseyin + Claude Opus 4.7 (1M context)
**Date:** 2026-05-03
**Depends on:** v0.8.1 contract set
**Blocks:** mainnet deployment

---

## Why now

Plan-5 compliance hooks shipped Phase 0 in prod (2026-05-02). With the regulatory bar in place, the next pre-mainnet bar is reducing on-chain risk. Without audit budget, the play is to **maximise the free signal** (static analysis, self-review, public surface, bounty) and treat the paid audit as a future upgrade once revenue exists.

Three layers, all free or pay-on-findings:
1. **Static analysis CI gate** — Slither + Mythril gating every push. Already in CI as of this plan.
2. **Self-audit + public surface** — threat model, NatSpec sweep, deployed contracts verified on Arcscan, repo public. Community spots things for free if the surface is readable.
3. **Bug bounty as the live shield** — Immunefi or in-house, pay-on-findings. Severity-graded pool, no upfront cost beyond setup time.

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

## Zero-budget path (canonical strategy until revenue exists)

The whole plan modulates around four moves we can make for free or close to it. Run these in this order; each one independently moves the needle.

### Layer 1 — Static analysis (already shipping)

- **Slither** — runs on every push/PR, `fail-on: medium`. Triage in `.slither-triage.md`.
- **Mythril** — runs on push (skipped on PR for speed), 30-min timeout, V8 only. Symbolic execution catches things Slither misses.
- **forge coverage** — already runs; **add a threshold gate**: lines ≥ 95%, branches ≥ 90%. Cheap follow-up PR.
- **solhint** (low-priority polish) — NatSpec gaps, ordering, naming. Nice-to-have, skip if it slows you down.

These cost zero dollars and a few hours of triage as findings come in.

### Layer 2 — Self-audit + readability for community review

The single highest-leverage free move: **make the contracts easy for a stranger to read**. Even unpaid, eyes will land on a public repo if it looks readable. Bounty hunters scan public verified contracts daily.

- **Pre-audit cleanup PR** — delete or move to `legacy/` everything in the OUT-of-scope list. Keeps the canonical surface tight (~400 LOC). Free, ~half-day of work.
- **NatSpec coverage** — every external/public function gets `@notice`, `@param`, `@return`, `@dev` for non-obvious bits. Free, ~1 day.
- **Threat model document** — `docs/audit/threat-model.md`. Actors, assets, attack surface, mitigations, known assumptions. Free, ~1 day.
- **Verify on Arcscan** — every deployed contract verified with source. Bytecode → readable code. Free, do it for every deploy.
- **Public-facing audit-readiness README** — top of `packages/contracts/README.md` says "this is the canonical contract, here's the threat model link, here's how to report a finding." Free, ~1 hour.

### Layer 3 — Bug bounty (pay only on findings)

The "live audit." Doesn't catch issues before mainnet, but bounds the upside for an attacker once we're on mainnet.

- **Immunefi** — set a tiered bounty pool. Critical $5–25k, High $1–5k, Medium $250–1k, Low $50–250. Pool can start at **$5k total** with severity caps; you only pay if a real finding lands. Setup: ~half-day to write the program scope + ToS, plus their onboarding. No upfront cost beyond a small platform fee on payouts.
- **In-house program** — point a `security@arcorapay.xyz` mailbox + a SECURITY.md, set known-good response timelines. Even cheaper but loses Immunefi's hunter network reach.

Pre-launch (testnet today): SECURITY.md is enough.
At mainnet T-0 with first real merchant flow: Immunefi program live, $5k pool, severity-tiered.

### Layer 4 — Cheap private review (when you have $5–10k spare, before $30k+)

If a small budget appears before full revenue:

- **Solo / freelance senior auditors** — Cantina has a "code review by individual senior auditor" option ($5–15k for V8-sized scope). Twitter audit indies (kalexotsu, OptimismPBC contributors, ex-Nexus folk) sometimes take small jobs at $5–10k.
- **Sherlock contest with low pool** — $10k contest pool can attract decent reviewer attention if the scope is tight. Cheaper than a private firm; the tradeoff is uneven coverage.
- **Spearbit / Cantina competition entry** — if they're running a sponsored or public competition that fits, free entry, sponsor pays prize pool.

**Skip until full audit budget**: OpenZeppelin, Trail of Bits, full-team Spearbit private. They are correct picks at $30k+ but irrelevant pre-revenue.

### What "audit-ready without an audit" looks like

After Layers 1–3 are landed, this is what you can honestly say to a partner / merchant / regulator:

- "Slither + Mythril gate every PR; medium+ findings either fixed or documented."
- "Test coverage ≥ 95% lines / 90% branches on the canonical contract set."
- "Threat model published; OUT-of-scope deprecated code removed from the production tree."
- "Contracts verified on Arcscan; repo is public for review."
- "Live Immunefi bug bounty with $X tiered pool."
- "External audit will be commissioned before $Y annual TVL or first $Z monthly settlement volume — whichever lands first."

That last bullet is honest and useful: it ties the audit trigger to a measurable business signal, not a vague calendar promise. Partners can validate "is this protocol approaching the trigger" themselves.

## Firm shortlist (paid track — for future reference, not the active plan)

Pick one of these tracks. Each row: typical scope, lead time, ballpark for a contract set our size (~400 LOC core + tests).

| Firm | Track | Lead time | Ballpark | Notes |
|---|---|---|---|---|
| **OpenZeppelin** | Premium / brand-name | 8–12 wk | $40–80k | Strong on access control, OZ-import-heavy code (we use a lot of OZ). |
| **Trail of Bits** | Premium / deep dive | 8–12 wk | $50–120k | Best-in-class but expensive; overkill for our size. |
| **Spearbit** | Senior-led, smaller team | 4–8 wk | $25–60k | Cadre model; good signal-to-noise for V8-sized scope. |
| **Cantina** | Spearbit's contest+private hybrid | 4–6 wk | $20–50k | Newer, but several Circle-adjacent jobs in their portfolio. |
| **Sherlock** | Contest + insurance | 2–4 wk | $20–40k | Time-boxed; coverage layer is genuinely useful as a signal to merchants. |
| **Code4rena** | Pure contest | 1–3 wk | $25–50k | Crowd-sourced; high finding volume, lower average severity, deduplication overhead. |

**Recommended path when budget exists**: Spearbit or Cantina for the primary review (private, senior-led, fast). Optionally chase with a Sherlock contest before mainnet to layer in crowd review. Skip OpenZeppelin/Trail unless we land a high-profile partner who asks for the brand name.

**Until budget exists**: see "Zero-budget path" section above. Layers 1–3 cover the floor; revisit Layer 4 when $5–10k is spare; revisit this firm shortlist when $30k+ is spare.

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

## Decisions to settle this week (zero-budget mode)

1. **Audit-trigger metric** — pick the threshold that triggers spending audit budget. Suggest: first to land of (a) annual TVL crosses $X, or (b) cumulative settled volume crosses $Y, or (c) a partner deal requires it as a precondition. Pin specific numbers; vague triggers don't fire.
2. **Bug bounty timing** — Immunefi program live by mainnet T-0 with a $5k tiered pool? Or hold until first paying merchant? Recommend tying to the first real settlement to avoid paying bounty platform fees on a dead program.
3. **Public review window before mainnet** — give the repo (with the audit-ready README + threat model) at least 2 weeks of public-but-no-mainnet exposure before flipping. Frees community signal at zero cost.

## Future decisions (revisit when budget appears)

1. **Which firm?** Spearbit + Cantina + Sherlock RFPs (in that order of preference) once $30k+ is spare.
2. **Budget ceiling?** $5–10k → Layer 4 (solo / Sherlock low-pool); $30–50k → Spearbit/Cantina; $50k+ → OpenZeppelin/Trail come back into play.
3. **Mainnet target date?** Doesn't gate on the audit anymore — gates on Layers 1–3 + bug bounty live.

---

## Effort (zero-budget path)

| Phase | Time | Cost |
|---|---|---|
| Mythril CI job + Slither triage policy | done (2026-05-03) | $0 |
| Pre-audit cleanup PR (delete or move OUT-of-scope to `legacy/`) | 0.5 day | $0 |
| Threat model document | 1 day | $0 |
| NatSpec sweep + Arcscan verify-on-deploy | 1 day | $0 |
| Coverage threshold gate (lines ≥95%, branches ≥90%) | 0.5 day | $0 |
| Audit-ready README + SECURITY.md | 0.5 day | $0 |
| Immunefi program setup (when revenue exists) | 0.5 day | $5k pool only paid on findings |
| **Total to "audit-ready without an audit"** | **~3.5 days** | **$0 cash before mainnet** |

Future paid track (when budget exists): firm engagement ~3-day remediation cycle on our side, calendar-driven from the firm.
