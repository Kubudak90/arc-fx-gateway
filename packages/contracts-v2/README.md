# @arcora/contracts-v2 — chain-agnostic CCTP router contracts

The **v2** on-chain layer: the buyer locks USDC in `PaymentEscrow` on their
pay-from chain, and settlement routes to the merchant's payout chain over
**CCTP V2** (`SettlementReceiver` on the destination). No custody; Li.Fi is used
only as a same-chain DEX swap. This is the target design for mainnet; it runs in
production behind `V2_ENABLED` (off by default).

## Provenance (why this is a separate package)

These contracts were developed in the standalone `agent-commerce-v2` repo and,
until **2026-07-05**, existed ONLY there — the main monorepo carried just the
compiled ABI (`packages/router/src/abi.ts`). This package consolidates the
source under one roof.

- **Imported verbatim** from `agent-commerce-v2/packages/contracts` at commit
  `99e6726894cc5ac5b8237dd7fe442e5270d9e50d` (2026-06-19).
- Build config (`foundry.toml`) is preserved unchanged — **solc 0.8.24**,
  optimizer 200, `evm_version = cancun`, `via_ir = false` — so the compiled
  bytecode reproduces exactly what was audited/deployed. Verified 2026-07-05:
  `PaymentEscrow` and `SettlementReceiver` bytecode is byte-identical to the
  source repo's, and the produced ABI matches `packages/router/src/abi.ts`
  (57 entries, zero diff).
- `lib/` (forge-std v1.16.1, openzeppelin-contracts v5.6.1) is **vendored** —
  tracked directly, not as submodules — matching the `packages/contracts`
  convention in this monorepo.

> This package is intentionally NOT merged into `packages/contracts` (the v1
> `ArcFXGateway`): the two are distinct deployment units on a different solc
> (0.8.26 vs 0.8.24) with colliding `Deploy.s.sol`/`MockERC20`, and the external
> audit scopes them separately (`docs/audit/rfp-external-audit.md`).

## Layout

```
src/
  PaymentEscrow.sol        — deposit / settle / refund / claim escrow (fund holder)
  SettlementReceiver.sol   — CCTP V2 destination: receiveAndSettle to the merchant
  libraries/CCTPMessageV2.sol
  interfaces/{ITokenMessengerV2,IMessageTransmitterV2}.sol
test/                      — 40 tests (PaymentEscrow 24, SettlementReceiver 16)
script/                    — Deploy / Wire / Config
```

## Build & test

```bash
forge build     # solc 0.8.24
forge test      # 40 passing
```

Deployed testnet addresses live in `packages/router/src/chains.ts`
(single source of truth, consumed by app + relayer).
