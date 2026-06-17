# STATE.md — pre-deploy self-audit loop (ArcFXGateway)

<!-- Read FIRST each run, write back LAST. Keep short; prune old runs into Archive. -->
<!-- This is the loop's only memory. The deterministic gate (pre-deploy-audit.sh) is the
     source of truth for pass/fail — never this file, never an agent's claim. -->

## Loop purpose
Recipe B (pre-deploy self-audit) on `packages/contracts` · ArcFXGateway.
Before any `forge script Deploy.s.sol --broadcast`, prove no NEW medium+ finding has
appeared vs a frozen baseline, and that the test + coverage gates actually measured the
audit-scope contract. The loop **surfaces and blocks; it never deploys** (autonomy L1).

## Repo
- path: `~/Desktop/arcorapay/arcorapay`  (note: nested; outer `~/Desktop/arcorapay` is NOT the repo)
- contracts: `packages/contracts`
- audit scope: `src/ArcFXGateway.sol`  (version-neutral; there is NO `ArcFXGatewayV10.sol` on disk)
- branch: `plan-1-protocol`

## Gate for this loop  (exact commands whose pass/fail IS the stop condition)
1. `forge build --sizes` clean
2. `forge test` green  (set `RUN_FUZZ=1` for `--profile ci`: 10k fuzz / 256×64 invariant)
3. `forge coverage --report lcov` + **no-op guard**: `src/ArcFXGateway.sol` has LF>0 in lcov.info
4. `slither . --filter-paths 'lib/|test/'` → **zero NEW medium+ findings** vs `baseline/slither-baseline.json`
5. `myth analyze src/ArcFXGateway.sol …` → zero issues  (heavy; CI-only today — see "Tooling gaps")
Stop: all required gates pass → `CLEAR TO DEPLOY`. Any fail → HALT, write findings below, flag human.

## Baseline
- slither baseline: **frozen (clean)** → `baseline/slither-baseline.json` (**0 medium+ findings**)
- frozen at commit: `9bcfc43` (plan-1-protocol)
- frozen on: `2026-06-17T20:36:28Z` (re-frozen after suppressing the 3 reentrancy FPs inline)
- The 3 `reentrancy-no-eth` mediums (settleInvoice#280 / claim#392 / adminRecoverEscrow#431) are now
  suppressed at the call site via `// slither-disable-next-line reentrancy-no-eth` (all genuinely
  `nonReentrant`, verified in source; also documented in `.slither-triage.md`). Baseline is 0-medium,
  so removing any disable makes the finding reappear as NEW → the diff gate catches the regression.

## Autonomy level
Current: **L1 (surface only).** The loop runs gates and writes findings; a human fixes and deploys.
Mainnet deploy + any privileged tx (owner/relayer/fee changes): **L1 permanently** — never automated.
Promote to L2 only after: 1 frozen baseline + 3 clean runs reviewed by hand (see README "Promotion").

## Tooling gaps found (the loop's first job — fix these, they are why the loop earns its keep)
- ✅ **coverage-gate no-op — FIXED 2026-06-17.** `bin/coverage-gate.sh` now scopes
  `src/ArcFXGateway.sol` (was the nonexistent `ArcFXGatewayV10.sol` → 0 lines → vacuous 100%).
  Verified: now reports real **100% lines (146/146) / 100% branches (44/44)**, exit 0.
- 🟡 **CI `contracts-ci` was RED since 2026-06-10 — partially remediated 2026-06-17.** Pre-fix run:
  `build-and-test` ✓, `slither` ✗, `mythril` ✗.
  - slither ✗ → **FIXED via inline `// slither-disable-next-line reentrancy-no-eth`** on the 3 call
    sites (#280/#392/#431). Verified locally: slither now reports 0 medium (5 info, 7 low). The
    `slither.db.json` triage-DB approach was tried then ABANDONED (brittle: coupled to slither version
    AND source line positions). Inline is version- + line-drift-robust; the action needs no change.
    → confirm green on the next CI push.
  - mythril ✗ → **the same `pkg_resources` / setuptools≥81 breakage** (confirmed: local myth crashed
    identically; after `setuptools<81` myth runs and reports **0 issues** on the contract → CI ✗ was
    tooling, not a real finding). **FIXED 2026-06-17 in `contracts-ci.yml`:** `pip install 'setuptools<81'`
    added AFTER `pip install mythril==0.24.8` in the Install Mythril step. → confirm green on next push.
- ⚠️ **no V10+ fuzz/invariant suite** (per CI comment + threat model). `forge test --profile ci`
  runs 10k fuzz but there are no invariant tests for current scope yet. Recipe-B can't assert the
  fee-once / refund-window invariants until they're written as invariant tests.
- ✅ **mythril local — WORKING 2026-06-17.** `myth v0.24.8` via `pipx --python python3.11` + injected
  `setuptools<81` (else `eth/__init__.py` → `import pkg_resources` crashes). Drop `ALLOW_NO_MYTHRIL=1`
  from gate runs now.

## New findings — needs human   (rewritten each failing run; empty when last run was CLEAR)
- _none recorded yet — first run pending_

## Run log   (newest first; prune to ~10)
- 2026-06-17T20:36Z · @9bcfc43 · remediation: 3 reentrancy mediums suppressed inline (slither now 0 medium, verified) · baseline RE-FROZEN clean (0 medium+) · slither.db.json abandoned
- 2026-06-17 · coverage-gate.sh fixed (real 100/100) · mythril working locally (setuptools<81)
- 2026-06-16T21:51Z · @9bcfc43 · **CLEAR** · build✓ · 86 tests✓ · cov 100/100✓ · slither 0-new (3 baseline)✓ · mythril skipped · coverage-gate flagged vacuous
- 2026-06-16T21:48Z · @9bcfc43 · baseline frozen (initial: 3 medium slither findings)

## Archive
