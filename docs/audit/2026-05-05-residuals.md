# Audit 2026-05-05 — Residual findings

This document tracks audit findings from the 2026-05-05 pass that are
**not** fully resolved on-chain. Each row links to the off-chain mitigation
shipped in this audit cycle and the on-chain fix planned for V10.

V9 is immutable on-chain, so several findings get an off-chain workaround
(monitoring, deploy guard, NatSpec correction) here and a structural fix
when V10 ships.

## Deferred to V10

| Finding | Plan | Status |
|--------|------|--------|
| H4 (refund custody) | V10 custody model | Workaround shipped (allowance check + monitoring) — see `docs/runbooks/h4-refund-approval.md` |
| M3 (fee bound) | V10 in-constructor cap | Off-chain: NatSpec WARNING on V9 constructor + `require(feeBps <= 1000)` in `DeployV9.s.sol` — shipped Phase 6a (2026-05-06) |
| M4 (reactivate semantics) | V10 explicit `reactivateMerchant` | Off-chain: NatSpec corrected on `deactivateMerchant` — shipped Phase 6a (2026-05-06) |
