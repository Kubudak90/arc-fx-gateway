# Pre-deploy self-audit loop (ArcFXGateway)

A **Recipe B** loop from the `agentic-loop-design` skill: before any gateway deploy, prove no new
security finding has crept in versus a frozen baseline — and make a deploy **impossible to start**
while a gate is red. It does **not** deploy anything; it surfaces and blocks. (Autonomy **L1**.)

This is the enforced version of the manual "Pre-deploy" checkboxes in
`docs/audit/deploy-checklist.md §1`. Run it as the last thing before `forge script … --broadcast`.

## Why it earns its keep (it already found one)
CI is green, but green ≠ audited. First inspection found `bin/coverage-gate.sh` scopes a file that
doesn't exist (`ArcFXGatewayV10.sol`; the real file is `ArcFXGateway.sol`) → it measures 0 lines and
reports 100%. The loop's coverage **no-op guard** catches exactly this: a gate passing while
measuring nothing. See `STATE.md → Tooling gaps`.

## The six parts (what's wired, what's deferred)
| Part | Status |
|---|---|
| 1. Trigger | manual, run before deploy (see "Wire the trigger") — start here, automate later |
| 2. Memory | `STATE.md` — read first, written back on every blocked run |
| 5. Stop condition | `pre-deploy-audit.sh` exit code (external + verifiable), never an agent's claim |
| 6. Human gate | **L1** — surfaces only; you fix and deploy |
| 3. Writer/checker | deferred — `loop-prompt.md` is ready for when you promote toward L2 |
| 4. Worktrees | not needed (single read-only gate, no parallel writers) |

## First run (bootstrap)
```bash
cd packages/contracts/audit/preflight
chmod +x pre-deploy-audit.sh

# 1. Freeze the baseline on a commit you trust (does a forge build + slither, ~30–60s):
./pre-deploy-audit.sh --freeze-baseline
#    → review each medium+ finding it reports; accepted ones get a row in
#      packages/contracts/.slither-triage.md. Update STATE.md "Baseline" block.

# 2. Run the gate:
./pre-deploy-audit.sh
#    RUN_FUZZ=1          → forge test --profile ci (10k fuzz / 256×64 invariant)  [slower]
#    ALLOW_NO_MYTHRIL=1  → proceed without local mythril (CI still enforces on push)
```
Exit 0 + `CLEAR TO DEPLOY` → proceed with the deploy-checklist. Exit 1 → findings written to
`STATE.md`, do not deploy.

## Wire the trigger (pick one, least → most automatic)
- **Manual (default, L1-appropriate):** run it yourself as deploy-checklist §1.
- **Pre-push hook, release branch only** (`.git/hooks/pre-push`): block a push to a `release/*` or
  tag ref unless the gate passes. Keep it off `plan-1-protocol` — you push docs commits there
  constantly and the gate (esp. mythril) is slow.
- **Wrap the deploy:** a `make deploy-testnet` that runs `pre-deploy-audit.sh && forge script …`.
  The `&&` is the gate. Mainnet stays a separate, never-wrapped manual command.

## Autonomy ladder & promotion
Start and stay at **L1** until you've earned more:
- **L1 (now):** gate runs, findings surfaced, human does everything.
- **L2 (next):** the agent (`loop-prompt.md`) triages findings into STATE for you — still no code edits.
  Promote after: baseline frozen + **3 consecutive runs you reviewed by hand** and agreed with.
- **L3:** agent may auto-add justified `.slither-triage.md` rows / draft fix PRs — human merges.
- **L4: never** for anything that deploys or changes owner/relayer/fee. Mainnet deploy is manual,
  every time. (Recorded permanently in `STATE.md → Autonomy level`.)

## Token-cost discipline
- **Green run = 0 tokens.** Gates are pure shell (`forge`/`slither`/`jq`); the agent only runs on a
  blocked run, and only once you opt into L2. So the steady-state cost is compute, not tokens.
- Compute per run (local): `forge build` few s · `forge test` few s (10k fuzz: minutes) ·
  `forge coverage` ~30s · `slither` ~30s · `mythril` ~10min (the reason it's opt-in locally).
- When you promote to L2: one triage pass ≈ 15–40k tokens (reads STATE + gate logs). Fires only on
  red, and deploys are rare → negligible monthly. Re-measure after 3 runs before going further.

## Files
- `STATE.md` — loop memory (read first, write last). The most important file here.
- `pre-deploy-audit.sh` — the gate / stop condition. `--freeze-baseline` to (re)snapshot.
- `loop-prompt.md` — L2 triage-pass instructions (read-only; never claims "clear").
- `baseline/slither-baseline.json` — frozen reference (created by `--freeze-baseline`; commit it).

## Removal
Self-contained: `rm -rf packages/contracts/audit/preflight` removes the loop. It edits no existing file.
