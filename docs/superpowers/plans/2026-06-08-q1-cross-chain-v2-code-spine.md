# Q1 Cross-Chain V2 Code Spine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Arcora's Q1 v2.0 cross-chain code spine: CCTP-supported EVM source-chain USDC payments into Arc, Arc-side payout-token settlement, demo-ready Base/Ethereum routes, telemetry, and a separable bridge/settlement relayer architecture.

**Architecture:** Keep the existing Arc-only Permit2 flow intact while adding a separate cross-chain payment path. A new shared `@arcora/crosschain-core` package owns route config, state names, amount helpers, and pure transition rules. `packages/app` creates cross-chain payment intents and verifies customer-submitted burn transactions; `ops/relayer` polls Circle IRIS, calls destination `receiveMessage`, optionally swaps Arc USDC to the merchant payout token, and calls `ArcFXGateway.settleInvoice`. Bridge and settlement run in one daemon in Q1 but through separate interfaces.

**Tech Stack:** TypeScript, Next.js 15 App Router, Drizzle/Postgres, viem, wagmi, Circle App Kit, Circle CCTP IRIS API, Vitest, Foundry only for compatibility checks.

---

## Source Inputs

- Strategy spec: `docs/superpowers/specs/2026-06-08-arcora-12-month-strategy-design.md`
- Current Arc-only relayer: `ops/relayer/run.ts`
- Current invoice/checkout API: `packages/app/app/api/invoices/route.ts`, `packages/app/app/api/checkout/authorize/route.ts`, `packages/app/app/api/checkout/submit/route.ts`
- Current DB schema: `packages/app/lib/db/schema.ts`
- Current gateway: `packages/contracts/src/ArcFXGateway.sol`
- Context7 docs checked on 2026-06-08:
  - `/circlefin/circle-cctp-crosschain-transfer`: CCTP EVM burn, IRIS attestation, destination `receiveMessage`
  - `/websites/developers_circle`: App Kit bridge/swap SDK context and chain naming
  - `/wevm/viem`: `writeContract`, `sendTransaction`, `readContract`, `parseAbi`, typed contract interaction

## Q1 Scope Boundary

In scope:

- Base and Ethereum demo routes plus config for the remaining CCTP EVM chains behind feature flags.
- Source-chain USDC only.
- Arc destination settlement in merchant payout token.
- One daemon process with separable route planner, bridge executor, and settlement executor.
- Risk-policy data model with default 7-day effective tier.
- Telemetry for checkout conversion, settlement latency, and failure reason.
- Demo/smoke scripts that exercise the complete state machine with real wallets.

Out of scope for this plan:

- Contract-level variable refund windows.
- Automated risk tier upgrades.
- Shopify, pricing, billing, KYB provider, and external audit remediation.
- Non-EVM sources.
- Source-side arbitrary-token aggregation.

## File Structure

Create:

- `packages/crosschain-core/package.json`
- `packages/crosschain-core/tsconfig.json`
- `packages/crosschain-core/src/index.ts`
- `packages/crosschain-core/src/chains.ts`
- `packages/crosschain-core/src/amounts.ts`
- `packages/crosschain-core/src/states.ts`
- `packages/crosschain-core/src/planner.ts`
- `packages/crosschain-core/test/amounts.test.ts`
- `packages/crosschain-core/test/states.test.ts`
- `packages/crosschain-core/test/planner.test.ts`
- `packages/app/lib/db/migrations/0021_crosschain_v2.sql`
- `packages/app/lib/crosschain/intent.ts`
- `packages/app/lib/crosschain/receipt.ts`
- `packages/app/lib/crosschain/receipt.test.ts`
- `packages/app/lib/crosschain/telemetry.ts`
- `packages/app/app/api/checkout/crosschain/prepare/route.ts`
- `packages/app/app/api/checkout/crosschain/prepare/route.test.ts`
- `packages/app/app/api/checkout/crosschain/submit/route.ts`
- `packages/app/app/api/checkout/crosschain/submit/route.test.ts`
- `packages/app/app/api/checkout/crosschain/status/[id]/route.ts`
- `packages/app/app/api/checkout/crosschain/status/[id]/route.test.ts`
- `packages/app/components/checkout/ChainSelector.tsx`
- `packages/app/components/checkout/CrossChainPayButton.tsx`
- `packages/app/components/checkout/CrossChainPayButton.test.tsx`
- `ops/relayer/crosschain-types.ts`
- `ops/relayer/cctp.ts`
- `ops/relayer/cctp.test.ts`
- `ops/relayer/arc-settlement.ts`
- `ops/relayer/arc-settlement.test.ts`
- `ops/relayer/crosschain-worker.ts`
- `ops/relayer/crosschain-worker.test.ts`
- `ops/relayer/smoke-crosschain.ts`
- `docs/runbooks/crosschain-v2-demo.md`

Modify:

- `package.json`
- `packages/app/package.json`
- `ops/relayer/package.json`
- `ops/relayer/tsconfig.json`
- `packages/app/lib/db/schema.ts`
- `packages/app/lib/db/migrations/meta/_journal.json`
- `packages/app/test/setup.ts`
- `packages/app/lib/chain/wagmi-config.tsx`
- `packages/app/app/i/[invoiceId]/CheckoutClient.tsx`
- `packages/app/app/api/checkout/status/[id]/route.ts`
- `ops/relayer/run.ts`
- `ops/relayer/.env.example`
- `README.md`

## Shared State Names

Use these names everywhere. Do not introduce aliases.

Cross-chain payment states:

```text
created
authorized
bridge_pending
bridge_confirmed
arc_swap_pending
settle_pending
paid
bridge_failed
arc_swap_failed
settle_failed
refunded
expired
```

State transition rule:

```text
created -> authorized -> bridge_pending -> bridge_confirmed -> arc_swap_pending -> settle_pending -> paid
```

Allowed failure transitions:

```text
authorized -> expired
bridge_pending -> bridge_failed
bridge_confirmed -> arc_swap_failed
arc_swap_pending -> arc_swap_failed
settle_pending -> settle_failed
settle_pending -> refunded
bridge_failed -> refunded
arc_swap_failed -> refunded
settle_failed -> refunded
```

## Task 1: Add Shared Cross-Chain Core Package

**Files:**
- Create: `packages/crosschain-core/package.json`
- Create: `packages/crosschain-core/tsconfig.json`
- Create: `packages/crosschain-core/src/index.ts`
- Create: `packages/crosschain-core/src/chains.ts`
- Create: `packages/crosschain-core/src/amounts.ts`
- Create: `packages/crosschain-core/src/states.ts`
- Create: `packages/crosschain-core/src/planner.ts`
- Test: `packages/crosschain-core/test/amounts.test.ts`
- Test: `packages/crosschain-core/test/states.test.ts`
- Test: `packages/crosschain-core/test/planner.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Create package metadata**

Create `packages/crosschain-core/package.json`:

```json
{
  "name": "@arcora/crosschain-core",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "viem": "^2.21.0"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

Create `packages/crosschain-core/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true,
    "noUncheckedIndexedAccess": true
  },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

Modify root `package.json` scripts:

```json
{
  "scripts": {
    "build:contracts": "pnpm --filter @arcora/contracts build",
    "test:contracts": "pnpm --filter @arcora/contracts test",
    "test:crosschain": "pnpm --filter @arcora/crosschain-core test",
    "typecheck:crosschain": "pnpm --filter @arcora/crosschain-core typecheck",
    "deploy:app": "cd packages/app && vercel --prod --yes",
    "deploy:demo": "cd packages/demo-merchant && vercel --prod --yes",
    "pitch:pdf": "marp --allow-local-files docs/PITCH.md -o docs/arcora-pitch.pdf",
    "pitch:html": "marp --allow-local-files docs/PITCH.md -o docs/arcora-pitch.html"
  }
}
```

- [ ] **Step 2: Write failing amount helper tests**

Create `packages/crosschain-core/test/amounts.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { formatBaseUnits, parseBaseUnits } from "../src/amounts";

describe("amount helpers", () => {
  it("parses 6-decimal USDC strings into base units", () => {
    expect(parseBaseUnits("1", 6)).toBe(1_000_000n);
    expect(parseBaseUnits("1.23", 6)).toBe(1_230_000n);
    expect(parseBaseUnits("0.000001", 6)).toBe(1n);
  });

  it("rejects over-precision instead of truncating money", () => {
    expect(() => parseBaseUnits("1.0000001", 6)).toThrow(/too many decimal places/);
  });

  it("formats base units without losing precision", () => {
    expect(formatBaseUnits(1_230_000n, 6)).toBe("1.23");
    expect(formatBaseUnits(1n, 6)).toBe("0.000001");
    expect(formatBaseUnits(1_000_000n, 6)).toBe("1");
  });
});
```

- [ ] **Step 3: Run amount tests and verify they fail**

Run:

```bash
pnpm --filter @arcora/crosschain-core test test/amounts.test.ts
```

Expected: FAIL because `../src/amounts` does not exist.

- [ ] **Step 4: Implement amount helpers**

Create `packages/crosschain-core/src/amounts.ts`:

```ts
export function parseBaseUnits(value: string, decimals: number): bigint {
  if (!/^\d+(\.\d+)?$/.test(value)) throw new Error(`invalid decimal amount: ${value}`);
  const [wholeRaw, fracRaw = ""] = value.split(".");
  if (fracRaw.length > decimals) {
    throw new Error(`too many decimal places: got ${fracRaw.length}, max ${decimals}`);
  }
  const whole = BigInt(wholeRaw);
  const frac = BigInt(fracRaw.padEnd(decimals, "0") || "0");
  return whole * 10n ** BigInt(decimals) + frac;
}

export function formatBaseUnits(value: bigint, decimals: number): string {
  if (value < 0n) throw new Error("negative amounts are not supported");
  const scale = 10n ** BigInt(decimals);
  const whole = value / scale;
  const frac = (value % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return frac.length === 0 ? whole.toString() : `${whole}.${frac}`;
}

export function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new Error("denominator must be positive");
  return (numerator + denominator - 1n) / denominator;
}
```

- [ ] **Step 5: Write failing state transition tests**

Create `packages/crosschain-core/test/states.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { assertTransition, isTerminalCrosschainState } from "../src/states";

describe("cross-chain state machine", () => {
  it("allows the happy path", () => {
    expect(() => assertTransition("created", "authorized")).not.toThrow();
    expect(() => assertTransition("authorized", "bridge_pending")).not.toThrow();
    expect(() => assertTransition("bridge_pending", "bridge_confirmed")).not.toThrow();
    expect(() => assertTransition("bridge_confirmed", "arc_swap_pending")).not.toThrow();
    expect(() => assertTransition("arc_swap_pending", "settle_pending")).not.toThrow();
    expect(() => assertTransition("settle_pending", "paid")).not.toThrow();
  });

  it("rejects skipping bridge verification", () => {
    expect(() => assertTransition("bridge_pending", "settle_pending"))
      .toThrow(/invalid crosschain transition/);
  });

  it("marks terminal states", () => {
    expect(isTerminalCrosschainState("paid")).toBe(true);
    expect(isTerminalCrosschainState("refunded")).toBe(true);
    expect(isTerminalCrosschainState("settle_pending")).toBe(false);
  });
});
```

- [ ] **Step 6: Run state tests and verify they fail**

Run:

```bash
pnpm --filter @arcora/crosschain-core test test/states.test.ts
```

Expected: FAIL because `../src/states` does not exist.

- [ ] **Step 7: Implement state machine**

Create `packages/crosschain-core/src/states.ts`:

```ts
export const CROSSCHAIN_STATES = [
  "created",
  "authorized",
  "bridge_pending",
  "bridge_confirmed",
  "arc_swap_pending",
  "settle_pending",
  "paid",
  "bridge_failed",
  "arc_swap_failed",
  "settle_failed",
  "refunded",
  "expired",
] as const;

export type CrosschainState = typeof CROSSCHAIN_STATES[number];

const allowed: Record<CrosschainState, readonly CrosschainState[]> = {
  created: ["authorized", "expired"],
  authorized: ["bridge_pending", "expired"],
  bridge_pending: ["bridge_confirmed", "bridge_failed", "expired"],
  bridge_confirmed: ["arc_swap_pending", "settle_pending", "arc_swap_failed"],
  arc_swap_pending: ["settle_pending", "arc_swap_failed"],
  settle_pending: ["paid", "settle_failed"],
  paid: [],
  bridge_failed: ["refunded"],
  arc_swap_failed: ["refunded"],
  settle_failed: ["refunded"],
  refunded: [],
  expired: [],
};

export function assertTransition(from: CrosschainState, to: CrosschainState): void {
  if (!allowed[from].includes(to)) {
    throw new Error(`invalid crosschain transition: ${from} -> ${to}`);
  }
}

export function isTerminalCrosschainState(state: CrosschainState): boolean {
  return allowed[state].length === 0;
}
```

- [ ] **Step 8: Write failing route planner tests**

Create `packages/crosschain-core/test/planner.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { planCrosschainRoute } from "../src/planner";
import { parseChainRegistryJson } from "../src/chains";

const registry = parseChainRegistryJson(JSON.stringify({
  "arc-testnet": {
    cctpDomain: 30,
    tokenMessenger: "0x1111111111111111111111111111111111111111",
    messageTransmitter: "0x2222222222222222222222222222222222222222",
    usdcAddress: "0x3600000000000000000000000000000000000000",
    eurcAddress: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a"
  },
  "base-sepolia": {
    cctpDomain: 6,
    tokenMessenger: "0x3333333333333333333333333333333333333333",
    messageTransmitter: "0x4444444444444444444444444444444444444444",
    usdcAddress: "0x5555555555555555555555555555555555555555"
  },
  "ethereum-sepolia": {
    cctpDomain: 0,
    tokenMessenger: "0x6666666666666666666666666666666666666666",
    messageTransmitter: "0x7777777777777777777777777777777777777777",
    usdcAddress: "0x8888888888888888888888888888888888888888"
  }
}));

describe("planCrosschainRoute", () => {
  it("plans Base Sepolia USDC into Arc payout USDC", () => {
    const route = planCrosschainRoute({
      registry,
      sourceChainId: 84532,
      destinationChainId: 5042002,
      sourceAmountBaseUnits: 5_000_000n,
      payoutToken: "0x3600000000000000000000000000000000000000",
      enabledSourceChains: [84532],
    });

    expect(route.source.chainId).toBe(84532);
    expect(route.destination.chainId).toBe(5042002);
    expect(route.sourceToken.address).toBe("0x5555555555555555555555555555555555555555");
    expect(route.destinationToken.address).toBe("0x3600000000000000000000000000000000000000");
    expect(route.requiresArcSwap).toBe(false);
  });

  it("plans Ethereum Sepolia USDC into Arc payout EURC with Arc-side swap", () => {
    const route = planCrosschainRoute({
      registry,
      sourceChainId: 11155111,
      destinationChainId: 5042002,
      sourceAmountBaseUnits: 12_500_000n,
      payoutToken: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a",
      enabledSourceChains: [11155111],
    });

    expect(route.requiresArcSwap).toBe(true);
    expect(route.arcSwap.tokenIn).toBe("USDC");
    expect(route.arcSwap.tokenOut).toBe("EURC");
  });

  it("rejects disabled source chains", () => {
    expect(() => planCrosschainRoute({
      registry,
      sourceChainId: 84532,
      destinationChainId: 5042002,
      sourceAmountBaseUnits: 1_000_000n,
      payoutToken: "0x3600000000000000000000000000000000000000",
      enabledSourceChains: [],
    })).toThrow(/source chain disabled/);
  });
});
```

- [ ] **Step 9: Run planner tests and verify they fail**

Run:

```bash
pnpm --filter @arcora/crosschain-core test test/planner.test.ts
```

Expected: FAIL because `../src/planner` and `../src/chains` do not exist.

- [ ] **Step 10: Implement chain config and planner**

Create `packages/crosschain-core/src/chains.ts`:

```ts
import type { Address } from "viem";

export type ChainKey =
  | "arc-testnet"
  | "base-sepolia"
  | "ethereum-sepolia"
  | "arbitrum-sepolia"
  | "optimism-sepolia"
  | "polygon-amoy"
  | "avalanche-fuji"
  | "linea-sepolia";

export interface TokenConfig {
  symbol: "USDC" | "EURC";
  address: Address;
  decimals: number;
}

export interface CctpChainConfig {
  key: ChainKey;
  label: string;
  chainId: number;
  cctpDomain: number;
  rpcEnv: string;
  tokenMessenger: Address;
  messageTransmitter: Address;
  tokens: {
    USDC: TokenConfig;
    EURC?: TokenConfig;
  };
}

const STATIC_CHAINS: Record<ChainKey, Pick<CctpChainConfig, "key" | "label" | "chainId" | "rpcEnv">> = {
  "arc-testnet": { key: "arc-testnet", label: "Arc Testnet", chainId: 5_042_002, rpcEnv: "ARC_TESTNET_RPC" },
  "base-sepolia": { key: "base-sepolia", label: "Base Sepolia", chainId: 84_532, rpcEnv: "BASE_SEPOLIA_RPC" },
  "ethereum-sepolia": { key: "ethereum-sepolia", label: "Ethereum Sepolia", chainId: 11_155_111, rpcEnv: "ETHEREUM_SEPOLIA_RPC" },
  "arbitrum-sepolia": { key: "arbitrum-sepolia", label: "Arbitrum Sepolia", chainId: 421_614, rpcEnv: "ARBITRUM_SEPOLIA_RPC" },
  "optimism-sepolia": { key: "optimism-sepolia", label: "Optimism Sepolia", chainId: 11_155_420, rpcEnv: "OPTIMISM_SEPOLIA_RPC" },
  "polygon-amoy": { key: "polygon-amoy", label: "Polygon Amoy", chainId: 80_002, rpcEnv: "POLYGON_AMOY_RPC" },
  "avalanche-fuji": { key: "avalanche-fuji", label: "Avalanche Fuji", chainId: 43_113, rpcEnv: "AVALANCHE_FUJI_RPC" },
  "linea-sepolia": { key: "linea-sepolia", label: "Linea Sepolia", chainId: 59_141, rpcEnv: "LINEA_SEPOLIA_RPC" },
};

export type ChainRegistry = ReadonlyMap<number, CctpChainConfig>;

function address(value: unknown, field: string): Address {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value) || /^0x0{40}$/i.test(value)) {
    throw new Error(`invalid non-zero address for ${field}`);
  }
  return value as Address;
}

export function parseChainRegistryJson(raw: string): ChainRegistry {
  const parsed = JSON.parse(raw) as Record<string, {
    cctpDomain: number;
    tokenMessenger: string;
    messageTransmitter: string;
    usdcAddress: string;
    eurcAddress?: string;
  }>;
  const entries: [number, CctpChainConfig][] = [];

  for (const [rawKey, runtime] of Object.entries(parsed)) {
    const key = rawKey as ChainKey;
    const staticConfig = STATIC_CHAINS[key];
    if (!staticConfig) throw new Error(`unknown chain config key: ${rawKey}`);
    if (!Number.isInteger(runtime.cctpDomain) || runtime.cctpDomain < 0) {
      throw new Error(`invalid cctpDomain for ${rawKey}`);
    }
    entries.push([staticConfig.chainId, {
      ...staticConfig,
      cctpDomain: runtime.cctpDomain,
      tokenMessenger: address(runtime.tokenMessenger, `${rawKey}.tokenMessenger`),
      messageTransmitter: address(runtime.messageTransmitter, `${rawKey}.messageTransmitter`),
      tokens: {
        USDC: { symbol: "USDC", address: address(runtime.usdcAddress, `${rawKey}.usdcAddress`), decimals: 6 },
        ...(runtime.eurcAddress
          ? { EURC: { symbol: "EURC" as const, address: address(runtime.eurcAddress, `${rawKey}.eurcAddress`), decimals: 6 } }
          : {}),
      },
    }]);
  }
  return new Map(entries);
}

export function chainById(registry: ChainRegistry, chainId: number): CctpChainConfig {
  const chain = registry.get(chainId);
  if (!chain) throw new Error(`unsupported source chain: ${chainId}`);
  return chain;
}
```

Create `packages/crosschain-core/src/planner.ts`:

```ts
import type { Address } from "viem";
import { chainById, type ChainRegistry, type CctpChainConfig, type TokenConfig } from "./chains";

export interface PlannedCrosschainRoute {
  source: CctpChainConfig;
  destination: CctpChainConfig;
  sourceToken: TokenConfig;
  destinationToken: TokenConfig;
  sourceAmountBaseUnits: bigint;
  mintRecipientChain: "arc-testnet";
  requiresArcSwap: boolean;
  arcSwap: { tokenIn: "USDC"; tokenOut: "USDC" | "EURC" };
}

export function planCrosschainRoute(args: {
  registry: ChainRegistry;
  sourceChainId: number;
  destinationChainId: number;
  sourceAmountBaseUnits: bigint;
  payoutToken: Address;
  enabledSourceChains: readonly number[];
}): PlannedCrosschainRoute {
  const destination = chainById(args.registry, args.destinationChainId);
  if (destination.key !== "arc-testnet") throw new Error(`unsupported destination chain: ${args.destinationChainId}`);
  if (!args.enabledSourceChains.includes(args.sourceChainId)) {
    throw new Error(`source chain disabled: ${args.sourceChainId}`);
  }
  if (args.sourceAmountBaseUnits <= 0n) {
    throw new Error("source amount must be positive");
  }

  const source = chainById(args.registry, args.sourceChainId);
  const payout = args.payoutToken.toLowerCase();
  const usdc = destination.tokens.USDC;
  const eurc = destination.tokens.EURC;
  if (!eurc) throw new Error("Arc EURC config missing");

  const destinationToken =
    payout === usdc.address.toLowerCase() ? usdc :
    payout === eurc.address.toLowerCase() ? eurc :
    null;
  if (!destinationToken) throw new Error(`unsupported Arc payout token: ${args.payoutToken}`);

  return {
    source,
    destination,
    sourceToken: source.tokens.USDC,
    destinationToken,
    sourceAmountBaseUnits: args.sourceAmountBaseUnits,
    mintRecipientChain: "arc-testnet",
    requiresArcSwap: destinationToken.symbol !== "USDC",
    arcSwap: { tokenIn: "USDC", tokenOut: destinationToken.symbol },
  };
}
```

Create `packages/crosschain-core/src/index.ts`:

```ts
export * from "./amounts";
export * from "./chains";
export * from "./planner";
export * from "./states";
```

- [ ] **Step 11: Run core tests and typecheck**

Run:

```bash
pnpm --filter @arcora/crosschain-core test
pnpm --filter @arcora/crosschain-core typecheck
```

Expected: PASS.

- [ ] **Step 12: Commit Task 1**

```bash
git add package.json packages/crosschain-core
git commit -m "feat(crosschain): add shared v2 route core"
```

## Task 2: Add Cross-Chain DB Schema and Migration

**Files:**
- Create: `packages/app/lib/db/migrations/0021_crosschain_v2.sql`
- Modify: `packages/app/lib/db/migrations/meta/_journal.json`
- Modify: `packages/app/lib/db/schema.ts`
- Modify: `packages/app/test/setup.ts`
- Test: `packages/app/lib/db/schema.test.ts`

- [ ] **Step 1: Write failing schema tests**

Append to `packages/app/lib/db/schema.test.ts`:

```ts
import {
  crosschainPayments,
  checkoutTelemetry,
  crosschainPaymentStatus,
  settlementTier,
} from "./schema";

describe("cross-chain v2 schema", () => {
  it("exports cross-chain payment tables and enums", () => {
    expect(crosschainPaymentStatus.enumValues).toContain("bridge_pending");
    expect(crosschainPaymentStatus.enumValues).toContain("paid");
    expect(settlementTier.enumValues).toEqual(["zero_day", "one_day", "seven_day"]);
    expect(crosschainPayments.invoiceId.name).toBe("invoice_id");
    expect(checkoutTelemetry.eventType.name).toBe("event_type");
  });
});
```

- [ ] **Step 2: Run schema test and verify it fails**

Run:

```bash
pnpm --filter @arcora/app test lib/db/schema.test.ts
```

Expected: FAIL because the new exports do not exist.

- [ ] **Step 3: Add SQL migration**

Create `packages/app/lib/db/migrations/0021_crosschain_v2.sql`:

```sql
CREATE TYPE crosschain_payment_status AS ENUM (
  'created',
  'authorized',
  'bridge_pending',
  'bridge_confirmed',
  'arc_swap_pending',
  'settle_pending',
  'paid',
  'bridge_failed',
  'arc_swap_failed',
  'settle_failed',
  'refunded',
  'expired'
);

CREATE TYPE settlement_tier AS ENUM ('zero_day', 'one_day', 'seven_day');

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS settlement_tier settlement_tier NOT NULL DEFAULT 'seven_day',
  ADD COLUMN IF NOT EXISTS settlement_policy_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS crosschain_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id text NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL,
  payer text NOT NULL,
  source_chain_id integer NOT NULL,
  source_domain integer NOT NULL,
  source_token text NOT NULL,
  source_amount numeric NOT NULL,
  destination_chain_id integer NOT NULL,
  destination_domain integer NOT NULL,
  destination_token text NOT NULL,
  mint_recipient text NOT NULL,
  payout_token text NOT NULL,
  amount_out_min numeric NOT NULL,
  route_version text NOT NULL,
  status crosschain_payment_status NOT NULL DEFAULT 'created',
  burn_tx_hash text,
  burn_submitted_at timestamptz,
  cctp_message text,
  cctp_attestation text,
  bridge_receive_tx_hash text,
  bridge_amount_received numeric,
  bridge_confirmed_at timestamptz,
  arc_swap_tx_hash text,
  arc_swap_amount_out numeric,
  settle_tx_hash text,
  refund_tx_hash text,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  next_attempt timestamptz NOT NULL DEFAULT now(),
  lease_owner text,
  lease_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(invoice_id),
  UNIQUE(idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_crosschain_payments_status_next_attempt
  ON crosschain_payments(status, next_attempt);

CREATE INDEX IF NOT EXISTS idx_crosschain_payments_invoice
  ON crosschain_payments(invoice_id);

CREATE INDEX IF NOT EXISTS idx_crosschain_payments_burn_tx
  ON crosschain_payments(source_chain_id, burn_tx_hash);

CREATE TABLE IF NOT EXISTS checkout_telemetry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id text REFERENCES invoices(id) ON DELETE CASCADE,
  crosschain_payment_id uuid REFERENCES crosschain_payments(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  source_chain_id integer,
  elapsed_ms integer,
  error_code text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_checkout_telemetry_invoice_created
  ON checkout_telemetry(invoice_id, created_at);

CREATE INDEX IF NOT EXISTS idx_checkout_telemetry_event_created
  ON checkout_telemetry(event_type, created_at);
```

Append the migration journal entry to `packages/app/lib/db/migrations/meta/_journal.json`:

```json
{
  "idx": 21,
  "version": "7",
  "when": 1781086400000,
  "tag": "0021_crosschain_v2",
  "breakpoints": true
}
```

Keep the entry inside the existing `entries` array and preserve valid JSON. This repository's post-`0006` migrations are SQL-plus-journal entries without generated snapshots, so do not invent a `0021_snapshot.json`.

- [ ] **Step 4: Modify Drizzle schema**

Modify imports in `packages/app/lib/db/schema.ts` to include `uniqueIndex`:

```ts
import {
  pgTable, text, uuid, timestamp, integer, numeric, jsonb, customType, boolean, pgEnum, index, uniqueIndex,
} from "drizzle-orm/pg-core";
```

Add after `relayerQueueStatus`:

```ts
export const crosschainPaymentStatus = pgEnum("crosschain_payment_status", [
  "created",
  "authorized",
  "bridge_pending",
  "bridge_confirmed",
  "arc_swap_pending",
  "settle_pending",
  "paid",
  "bridge_failed",
  "arc_swap_failed",
  "settle_failed",
  "refunded",
  "expired",
]);

export const settlementTier = pgEnum("settlement_tier", ["zero_day", "one_day", "seven_day"]);
```

Add to `invoices` table:

```ts
  settlementTier: settlementTier("settlement_tier").notNull().default("seven_day"),
  settlementPolicySnapshot: jsonb("settlement_policy_snapshot").notNull().default({}),
```

Add after `relayerQueue`:

```ts
export const crosschainPayments = pgTable("crosschain_payments", {
  id: uuid("id").defaultRandom().primaryKey(),
  invoiceId: text("invoice_id").notNull().references(() => invoices.id, { onDelete: "cascade" }),
  idempotencyKey: text("idempotency_key").notNull(),
  payer: text("payer").notNull(),
  sourceChainId: integer("source_chain_id").notNull(),
  sourceDomain: integer("source_domain").notNull(),
  sourceToken: text("source_token").notNull(),
  sourceAmount: numeric("source_amount").notNull(),
  destinationChainId: integer("destination_chain_id").notNull(),
  destinationDomain: integer("destination_domain").notNull(),
  destinationToken: text("destination_token").notNull(),
  mintRecipient: text("mint_recipient").notNull(),
  payoutToken: text("payout_token").notNull(),
  amountOutMin: numeric("amount_out_min").notNull(),
  routeVersion: text("route_version").notNull(),
  status: crosschainPaymentStatus("status").notNull().default("created"),
  burnTxHash: text("burn_tx_hash"),
  burnSubmittedAt: timestamp("burn_submitted_at", { withTimezone: true }),
  cctpMessage: text("cctp_message"),
  cctpAttestation: text("cctp_attestation"),
  bridgeReceiveTxHash: text("bridge_receive_tx_hash"),
  bridgeAmountReceived: numeric("bridge_amount_received"),
  bridgeConfirmedAt: timestamp("bridge_confirmed_at", { withTimezone: true }),
  arcSwapTxHash: text("arc_swap_tx_hash"),
  arcSwapAmountOut: numeric("arc_swap_amount_out"),
  settleTxHash: text("settle_tx_hash"),
  refundTxHash: text("refund_tx_hash"),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  nextAttempt: timestamp("next_attempt", { withTimezone: true }).notNull().defaultNow(),
  leaseOwner: text("lease_owner"),
  leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("uniq_crosschain_payments_invoice").on(t.invoiceId),
  uniqueIndex("uniq_crosschain_payments_idempotency").on(t.idempotencyKey),
  index("idx_crosschain_payments_status_next_attempt").on(t.status, t.nextAttempt),
  index("idx_crosschain_payments_invoice").on(t.invoiceId),
  index("idx_crosschain_payments_burn_tx").on(t.sourceChainId, t.burnTxHash),
]);

export const checkoutTelemetry = pgTable("checkout_telemetry", {
  id: uuid("id").defaultRandom().primaryKey(),
  invoiceId: text("invoice_id").references(() => invoices.id, { onDelete: "cascade" }),
  crosschainPaymentId: uuid("crosschain_payment_id").references(() => crosschainPayments.id, { onDelete: "set null" }),
  eventType: text("event_type").notNull(),
  sourceChainId: integer("source_chain_id"),
  elapsedMs: integer("elapsed_ms"),
  errorCode: text("error_code"),
  metadata: jsonb("metadata").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("idx_checkout_telemetry_invoice_created").on(t.invoiceId, t.createdAt),
  index("idx_checkout_telemetry_event_created").on(t.eventType, t.createdAt),
]);
```

- [ ] **Step 5: Extend test env**

Append to `packages/app/test/setup.ts`:

```ts
process.env.NEXT_PUBLIC_CROSSCHAIN_ENABLED ??= "true";
process.env.CROSSCHAIN_ENABLED_SOURCE_CHAINS ??= "84532,11155111";
process.env.CROSSCHAIN_CHAIN_CONFIG_JSON ??= JSON.stringify({
  "arc-testnet": {
    cctpDomain: 30,
    tokenMessenger: "0x1111111111111111111111111111111111111111",
    messageTransmitter: "0x2222222222222222222222222222222222222222",
    usdcAddress: "0x3600000000000000000000000000000000000000",
    eurcAddress: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a"
  },
  "base-sepolia": {
    cctpDomain: 6,
    tokenMessenger: "0x3333333333333333333333333333333333333333",
    messageTransmitter: "0x4444444444444444444444444444444444444444",
    usdcAddress: "0x5555555555555555555555555555555555555555"
  },
  "ethereum-sepolia": {
    cctpDomain: 0,
    tokenMessenger: "0x6666666666666666666666666666666666666666",
    messageTransmitter: "0x7777777777777777777777777777777777777777",
    usdcAddress: "0x8888888888888888888888888888888888888888"
  }
});
process.env.BASE_SEPOLIA_RPC ??= "https://base-sepolia.example.invalid";
process.env.ETHEREUM_SEPOLIA_RPC ??= "https://ethereum-sepolia.example.invalid";
process.env.CCTP_IRIS_API_URL ??= "https://iris-api-sandbox.circle.com";
```

- [ ] **Step 6: Run schema tests**

Run:

```bash
pnpm --filter @arcora/app test lib/db/schema.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 2**

```bash
git add packages/app/lib/db/schema.ts packages/app/lib/db/migrations/0021_crosschain_v2.sql packages/app/lib/db/migrations/meta/_journal.json packages/app/lib/db/schema.test.ts packages/app/test/setup.ts
git commit -m "feat(app): add cross-chain payment schema"
```

## Task 3: Add Cross-Chain Prepare API

**Files:**
- Create: `packages/app/lib/crosschain/intent.ts`
- Create: `packages/app/lib/crosschain/telemetry.ts`
- Create: `packages/app/app/api/checkout/crosschain/prepare/route.ts`
- Test: `packages/app/app/api/checkout/crosschain/prepare/route.test.ts`
- Modify: `packages/app/package.json`

- [ ] **Step 1: Add workspace dependency**

Modify `packages/app/package.json` dependencies:

```json
{
  "dependencies": {
    "@arcora/crosschain-core": "workspace:*"
  }
}
```

Keep the existing dependencies unchanged.

Run `pnpm install` from the repository root immediately after this edit so the workspace symlink and `pnpm-lock.yaml` importer are updated before tests.

- [ ] **Step 2: Write failing prepare route tests**

Create `packages/app/app/api/checkout/crosschain/prepare/route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const dbState = {
  invoices: [{
    id: "0x" + "1".repeat(64),
    status: "created",
    payInToken: "0x3600000000000000000000000000000000000000",
    payoutToken: "0x3600000000000000000000000000000000000000",
    amountOut: "5000000",
    expiresAt: new Date(Date.now() + 30 * 60_000),
    merchantId: "merchant-1",
  }],
  crosschainRows: [] as any[],
  telemetryRows: [] as any[],
};

vi.mock("@/lib/db/client", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => dbState.invoices,
        }),
      }),
    }),
    insert: (table: any) => ({
      values: (row: any) => {
        const returning = async () => {
          if ("eventType" in row) {
            dbState.telemetryRows.push(row);
            return [{ id: "telemetry-1" }];
          }
          const inserted = { id: "11111111-1111-4111-8111-111111111111", ...row };
          dbState.crosschainRows.push(inserted);
          return [{ id: "11111111-1111-4111-8111-111111111111" }];
        };
        return {
          returning,
          onConflictDoUpdate: () => ({ returning }),
        };
      },
    }),
  },
}));

vi.mock("@/lib/compliance/factory", () => ({
  resolveComplianceProvider: () => ({ name: "noop" }),
}));

vi.mock("@/lib/compliance/screen", () => ({
  screenWithAudit: async () => ({ decision: "allow", risk: "low", reasons: [], ticketId: null }),
}));

function req(body: unknown) {
  return new Request("https://arcorapay.xyz/api/checkout/crosschain/prepare", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.10" },
    body: JSON.stringify(body),
  }) as any;
}

describe("POST /api/checkout/crosschain/prepare", () => {
  beforeEach(() => {
    dbState.crosschainRows = [];
    dbState.telemetryRows = [];
  });

  it("creates an authorized cross-chain intent for enabled Base Sepolia", async () => {
    const res = await POST(req({
      invoiceId: "0x" + "1".repeat(64),
      payer: "0x" + "a".repeat(40),
      sourceChainId: 84532,
    }));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.intentId).toBe("11111111-1111-4111-8111-111111111111");
    expect(body.sourceChain.chainId).toBe(84532);
    expect(body.depositForBurn.amount).toBe("5000000");
    expect(dbState.crosschainRows[0].status).toBe("authorized");
  });

  it("rejects disabled source chains", async () => {
    const res = await POST(req({
      invoiceId: "0x" + "1".repeat(64),
      payer: "0x" + "a".repeat(40),
      sourceChainId: 421614,
    }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("source_chain_disabled");
  });
});
```

- [ ] **Step 3: Run prepare tests and verify they fail**

Run:

```bash
pnpm --filter @arcora/app test app/api/checkout/crosschain/prepare/route.test.ts
```

Expected: FAIL because the route does not exist.

- [ ] **Step 4: Implement telemetry helper**

Create `packages/app/lib/crosschain/telemetry.ts`:

```ts
import { db } from "@/lib/db/client";
import { checkoutTelemetry } from "@/lib/db/schema";

export async function recordCheckoutEvent(args: {
  invoiceId?: string;
  crosschainPaymentId?: string;
  eventType: string;
  sourceChainId?: number;
  elapsedMs?: number;
  errorCode?: string;
  metadata?: Record<string, string | number | boolean | null>;
}): Promise<void> {
  await db.insert(checkoutTelemetry).values({
    invoiceId: args.invoiceId ?? null,
    crosschainPaymentId: args.crosschainPaymentId ?? null,
    eventType: args.eventType,
    sourceChainId: args.sourceChainId ?? null,
    elapsedMs: args.elapsedMs ?? null,
    errorCode: args.errorCode ?? null,
    metadata: args.metadata ?? {},
  });
}
```

- [ ] **Step 5: Implement intent helper**

Create `packages/app/lib/crosschain/intent.ts`:

```ts
import { randomUUID } from "node:crypto";
import type { Address } from "viem";
import { parseChainRegistryJson, planCrosschainRoute } from "@arcora/crosschain-core";

export function enabledSourceChainsFromEnv(): number[] {
  const raw = process.env.CROSSCHAIN_ENABLED_SOURCE_CHAINS ?? "";
  return raw.split(",").map((x) => x.trim()).filter(Boolean).map((x) => Number(x));
}

export function evmAddressToBytes32(address: Address): `0x${string}` {
  return `0x${address.toLowerCase().replace(/^0x/, "").padStart(64, "0")}`;
}

export function buildCrosschainIntent(args: {
  invoiceId: string;
  payer: Address;
  sourceChainId: number;
  payoutToken: Address;
  sourceAmountBaseUnits: bigint;
  relayerAddress: Address;
}) {
  const registryJson = process.env.CROSSCHAIN_CHAIN_CONFIG_JSON;
  if (!registryJson) throw new Error("CROSSCHAIN_CHAIN_CONFIG_JSON missing");
  const route = planCrosschainRoute({
    registry: parseChainRegistryJson(registryJson),
    sourceChainId: args.sourceChainId,
    destinationChainId: 5_042_002,
    sourceAmountBaseUnits: args.sourceAmountBaseUnits,
    payoutToken: args.payoutToken,
    enabledSourceChains: enabledSourceChainsFromEnv(),
  });

  return {
    idempotencyKey: `cc_${args.invoiceId}_${args.payer.toLowerCase()}_${args.sourceChainId}`,
    routeVersion: "crosschain-v2-q1",
    sourceAmountBaseUnits: args.sourceAmountBaseUnits,
    mintRecipient: evmAddressToBytes32(args.relayerAddress),
    destinationDomain: route.destination.cctpDomain,
    destinationChainId: route.destination.chainId,
    destinationToken: route.destination.tokens.USDC.address,
    intentNonce: randomUUID(),
    route,
  };
}
```

- [ ] **Step 6: Implement prepare route**

Create `packages/app/app/api/checkout/crosschain/prepare/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import type { Address } from "viem";
import { chainById, parseChainRegistryJson } from "@arcora/crosschain-core";
import { db } from "@/lib/db/client";
import { invoices, crosschainPayments } from "@/lib/db/schema";
import { resolveComplianceProvider } from "@/lib/compliance/factory";
import { screenWithAudit } from "@/lib/compliance/screen";
import { buildCrosschainIntent } from "@/lib/crosschain/intent";
import { recordCheckoutEvent } from "@/lib/crosschain/telemetry";
import { estimateSwapForTarget } from "@/lib/checkout/quote-server";

const HEX32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const ADDR = z.string().regex(/^0x[0-9a-fA-F]{40}$/);

const Body = z.object({
  invoiceId: HEX32,
  payer: ADDR,
  sourceChainId: z.number().int().positive(),
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = Body.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "bad_params", details: parsed.error.issues }, { status: 400 });
  }

  const { invoiceId, payer, sourceChainId } = parsed.data;
  const inv = (await db.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1))[0];
  if (!inv) return NextResponse.json({ error: "invoice_not_found" }, { status: 404 });
  if (inv.status !== "created") return NextResponse.json({ error: "invoice_not_payable", status: inv.status }, { status: 409 });
  if (inv.expiresAt.getTime() < Date.now()) return NextResponse.json({ error: "invoice_expired" }, { status: 410 });

  const provider = resolveComplianceProvider();
  const screen = await screenWithAudit({
    db,
    provider,
    address: payer,
    context: { flow: "customer_pay", invoiceId },
  });
  if (screen.decision !== "allow") {
    await recordCheckoutEvent({
      invoiceId,
      eventType: "crosschain_prepare_blocked",
      sourceChainId,
      errorCode: screen.decision,
    });
    return NextResponse.json({
      decision: screen.decision,
      ticketId: screen.ticketId,
    }, { status: screen.decision === "review" ? 202 : 403 });
  }

  const relayer = process.env.NEXT_PUBLIC_RELAYER_ADDRESS as Address | undefined;
  if (!relayer) return NextResponse.json({ error: "relayer_unconfigured" }, { status: 503 });

  let intent;
  try {
    const registryJson = process.env.CROSSCHAIN_CHAIN_CONFIG_JSON;
    if (!registryJson) throw new Error("CROSSCHAIN_CHAIN_CONFIG_JSON missing");
    const arc = chainById(parseChainRegistryJson(registryJson), 5_042_002);
    if (inv.payInToken.toLowerCase() !== arc.tokens.USDC.address.toLowerCase()) {
      return NextResponse.json({ error: "crosschain_requires_arc_usdc_payin" }, { status: 409 });
    }

    let sourceAmountBaseUnits = BigInt(inv.amountOut);
    if (inv.payoutToken.toLowerCase() !== arc.tokens.USDC.address.toLowerCase()) {
      if (!arc.tokens.EURC || inv.payoutToken.toLowerCase() !== arc.tokens.EURC.address.toLowerCase()) {
        return NextResponse.json({ error: "unsupported_payout_token" }, { status: 400 });
      }
      const quote = await estimateSwapForTarget({
        payInToken: "USDC",
        payoutToken: "EURC",
        targetOutputBaseUnits: BigInt(inv.amountOut),
      });
      sourceAmountBaseUnits = quote.recommendedPayInBaseUnits;
    }

    intent = buildCrosschainIntent({
      invoiceId,
      payer: payer as Address,
      sourceChainId,
      payoutToken: inv.payoutToken as Address,
      sourceAmountBaseUnits,
      relayerAddress: relayer,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const error = /source chain disabled/.test(msg) ? "source_chain_disabled" : "route_unavailable";
    return NextResponse.json({ error, detail: msg }, { status: 400 });
  }

  const inserted = await db.insert(crosschainPayments).values({
    invoiceId,
    idempotencyKey: intent.idempotencyKey,
    payer: payer.toLowerCase(),
    sourceChainId,
    sourceDomain: intent.route.source.cctpDomain,
    sourceToken: intent.route.sourceToken.address.toLowerCase(),
    sourceAmount: intent.sourceAmountBaseUnits.toString(),
    destinationChainId: intent.destinationChainId,
    destinationDomain: intent.destinationDomain,
    destinationToken: intent.destinationToken.toLowerCase(),
    mintRecipient: intent.mintRecipient.toLowerCase(),
    payoutToken: inv.payoutToken.toLowerCase(),
    amountOutMin: inv.amountOut,
    routeVersion: intent.routeVersion,
    status: "authorized",
  }).onConflictDoUpdate({
    target: crosschainPayments.idempotencyKey,
    set: { updatedAt: new Date() },
  }).returning({ id: crosschainPayments.id });

  const intentId = inserted[0]!.id;
  await recordCheckoutEvent({
    invoiceId,
    crosschainPaymentId: intentId,
    eventType: "crosschain_prepare_created",
    sourceChainId,
    metadata: { routeVersion: intent.routeVersion },
  });

  return NextResponse.json({
    intentId,
    invoiceId,
    sourceChain: {
      chainId: intent.route.source.chainId,
      label: intent.route.source.label,
      cctpDomain: intent.route.source.cctpDomain,
    },
    destinationChain: {
      chainId: intent.route.destination.chainId,
      label: intent.route.destination.label,
      cctpDomain: intent.route.destination.cctpDomain,
    },
    depositForBurn: {
      amount: intent.sourceAmountBaseUnits.toString(),
      burnToken: intent.route.sourceToken.address,
      tokenMessenger: intent.route.source.tokenMessenger,
      destinationDomain: intent.destinationDomain,
      mintRecipient: intent.mintRecipient,
      maxFee: "0",
      finalityThreshold: 2000,
    },
    expiresAt: inv.expiresAt.toISOString(),
  }, { status: 201 });
}
```

- [ ] **Step 7: Run prepare tests**

Run:

```bash
pnpm --filter @arcora/app test app/api/checkout/crosschain/prepare/route.test.ts
pnpm --filter @arcora/app typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit Task 3**

```bash
git add packages/app/package.json pnpm-lock.yaml packages/app/lib/crosschain packages/app/app/api/checkout/crosschain/prepare
git commit -m "feat(app): add cross-chain prepare endpoint"
```

## Task 4: Add Cross-Chain Submit API and Burn Receipt Binding

**Files:**
- Create: `packages/app/lib/crosschain/receipt.ts`
- Test: `packages/app/lib/crosschain/receipt.test.ts`
- Create: `packages/app/app/api/checkout/crosschain/submit/route.ts`
- Test: `packages/app/app/api/checkout/crosschain/submit/route.test.ts`

- [ ] **Step 1: Write failing receipt helper test inside submit route test**

Create `packages/app/app/api/checkout/crosschain/submit/route.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import { POST } from "./route";

const row = {
  id: "11111111-1111-4111-8111-111111111111",
  invoiceId: "0x" + "1".repeat(64),
  payer: "0x" + "a".repeat(40),
  sourceChainId: 84532,
  sourceToken: "0x5555555555555555555555555555555555555555",
  sourceAmount: "5000000",
  destinationDomain: 30,
  mintRecipient: "0x" + "0".repeat(24) + "9".repeat(40),
  status: "authorized",
};

const updates: any[] = [];

vi.mock("@/lib/db/client", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [row],
        }),
      }),
    }),
    update: () => ({
      set: (values: any) => ({
        where: () => ({
          returning: async () => {
            updates.push(values);
            return [{ id: "11111111-1111-4111-8111-111111111111" }];
          },
        }),
      }),
    }),
    insert: () => ({
      values: async () => [],
    }),
  },
}));

vi.mock("@/lib/crosschain/receipt", () => ({
  verifySourceBurnTx: async () => ({ ok: true, blockNumber: 123n }),
}));

function req(body: unknown) {
  return new Request("https://arcorapay.xyz/api/checkout/crosschain/submit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
}

describe("POST /api/checkout/crosschain/submit", () => {
  beforeEach(() => updates.length = 0);

  it("marks an authorized intent as bridge_pending after verified burn tx", async () => {
    const res = await POST(req({
      intentId: "11111111-1111-4111-8111-111111111111",
      burnTxHash: "0x" + "b".repeat(64),
    }));
    const body = await res.json();

    expect(res.status).toBe(202);
    expect(body.status).toBe("bridge_pending");
    expect(updates[0].status).toBe("bridge_pending");
    expect(updates[0].burnTxHash).toBe("0x" + "b".repeat(64));
  });
});
```

Create `packages/app/lib/crosschain/receipt.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { encodeFunctionData } from "viem";
import {
  TOKEN_MESSENGER_ABI,
  verifySourceBurnTx,
  type SourceReceiptClient,
} from "./receipt";

const payer = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const burnToken = "0x5555555555555555555555555555555555555555";
const mintRecipient = `0x${"0".repeat(24)}${"9".repeat(40)}` as const;
const messenger = "0x3333333333333333333333333333333333333333";

function client(amount: bigint): SourceReceiptClient {
  return {
    getTransaction: async () => ({
      from: payer,
      to: messenger,
      input: encodeFunctionData({
        abi: TOKEN_MESSENGER_ABI,
        functionName: "depositForBurn",
        args: [
          amount,
          30,
          mintRecipient,
          burnToken,
          `0x${"0".repeat(64)}`,
          0n,
          2000,
        ],
      }),
    }),
    getTransactionReceipt: async () => ({
      status: "success",
      blockNumber: 123n,
    }),
  };
}

describe("verifySourceBurnTx", () => {
  it("accepts a burn fully bound to the stored intent", async () => {
    await expect(verifySourceBurnTx({
      sourceChainId: 84532,
      burnTxHash: `0x${"b".repeat(64)}`,
      expectedPayer: payer,
      expectedAmount: 5_000_000n,
      expectedDestinationDomain: 30,
      expectedMintRecipient: mintRecipient,
      expectedBurnToken: burnToken,
      client: client(5_000_000n),
    })).resolves.toEqual({ ok: true, blockNumber: 123n });
  });

  it("rejects a transaction whose calldata amount differs from the intent", async () => {
    await expect(verifySourceBurnTx({
      sourceChainId: 84532,
      burnTxHash: `0x${"b".repeat(64)}`,
      expectedPayer: payer,
      expectedAmount: 5_000_000n,
      expectedDestinationDomain: 30,
      expectedMintRecipient: mintRecipient,
      expectedBurnToken: burnToken,
      client: client(4_999_999n),
    })).rejects.toThrow("burn_tx_wrong_amount");
  });
});
```

- [ ] **Step 2: Run submit tests and verify they fail**

Run:

```bash
pnpm --filter @arcora/app test app/api/checkout/crosschain/submit/route.test.ts
pnpm --filter @arcora/app test lib/crosschain/receipt.test.ts
```

Expected: FAIL because the route does not exist.

- [ ] **Step 3: Implement source burn verifier**

Create `packages/app/lib/crosschain/receipt.ts`:

```ts
import {
  createPublicClient,
  decodeFunctionData,
  http,
  parseAbi,
  type Address,
  type Hex,
} from "viem";
import { chainById, parseChainRegistryJson } from "@arcora/crosschain-core";

export interface SourceReceiptClient {
  getTransaction(args: { hash: Hex }): Promise<{
    from: Address;
    to: Address | null;
    input: Hex;
  }>;
  getTransactionReceipt(args: { hash: Hex }): Promise<{
    status: "success" | "reverted";
    blockNumber: bigint;
  }>;
}

export const TOKEN_MESSENGER_ABI = parseAbi([
  "function depositForBurn(uint256 amount,uint32 destinationDomain,bytes32 mintRecipient,address burnToken,bytes32 destinationCaller,uint256 maxFee,uint32 minFinalityThreshold)",
]);

export async function verifySourceBurnTx(args: {
  sourceChainId: number;
  burnTxHash: Hex;
  expectedPayer: string;
  expectedAmount: bigint;
  expectedDestinationDomain: number;
  expectedMintRecipient: Hex;
  expectedBurnToken: Address;
  client?: SourceReceiptClient;
}): Promise<{ ok: true; blockNumber: bigint }> {
  const registryJson = process.env.CROSSCHAIN_CHAIN_CONFIG_JSON;
  if (!registryJson) throw new Error("CROSSCHAIN_CHAIN_CONFIG_JSON missing");
  const chain = chainById(parseChainRegistryJson(registryJson), args.sourceChainId);
  const rpc = process.env[chain.rpcEnv];
  if (!rpc) throw new Error(`missing_rpc:${chain.rpcEnv}`);
  const client: SourceReceiptClient = args.client
    ?? createPublicClient({ transport: http(rpc) }) as unknown as SourceReceiptClient;

  const [tx, receipt] = await Promise.all([
    client.getTransaction({ hash: args.burnTxHash }),
    client.getTransactionReceipt({ hash: args.burnTxHash }),
  ]);

  if (receipt.status !== "success") throw new Error("burn_tx_reverted");
  if (tx.to?.toLowerCase() !== chain.tokenMessenger.toLowerCase()) {
    throw new Error("burn_tx_wrong_token_messenger");
  }
  if (tx.from.toLowerCase() !== args.expectedPayer.toLowerCase()) {
    throw new Error("burn_tx_wrong_payer");
  }

  let decoded;
  try {
    decoded = decodeFunctionData({
      abi: TOKEN_MESSENGER_ABI,
      data: tx.input,
    });
  } catch {
    throw new Error("burn_tx_invalid_calldata");
  }
  if (decoded.functionName !== "depositForBurn") {
    throw new Error("burn_tx_wrong_function");
  }

  const [
    amount,
    destinationDomain,
    mintRecipient,
    burnToken,
    destinationCaller,
    maxFee,
    minFinalityThreshold,
  ] = decoded.args;

  if (amount !== args.expectedAmount) throw new Error("burn_tx_wrong_amount");
  if (destinationDomain !== args.expectedDestinationDomain) throw new Error("burn_tx_wrong_destination_domain");
  if (mintRecipient.toLowerCase() !== args.expectedMintRecipient.toLowerCase()) {
    throw new Error("burn_tx_wrong_mint_recipient");
  }
  if (burnToken.toLowerCase() !== args.expectedBurnToken.toLowerCase()) {
    throw new Error("burn_tx_wrong_burn_token");
  }
  if (destinationCaller !== `0x${"0".repeat(64)}`) throw new Error("burn_tx_wrong_destination_caller");
  if (maxFee !== 0n) throw new Error("burn_tx_unexpected_max_fee");
  if (minFinalityThreshold !== 2000) throw new Error("burn_tx_wrong_finality_threshold");

  return { ok: true, blockNumber: receipt.blockNumber };
}
```

- [ ] **Step 4: Implement submit route**

Create `packages/app/app/api/checkout/crosschain/submit/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import type { Address, Hex } from "viem";
import { db } from "@/lib/db/client";
import { crosschainPayments } from "@/lib/db/schema";
import { verifySourceBurnTx } from "@/lib/crosschain/receipt";
import { recordCheckoutEvent } from "@/lib/crosschain/telemetry";

const Body = z.object({
  intentId: z.string().uuid(),
  burnTxHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = Body.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "bad_params", details: parsed.error.issues }, { status: 400 });
  }

  const { intentId, burnTxHash } = parsed.data;
  const payment = (await db
    .select()
    .from(crosschainPayments)
    .where(eq(crosschainPayments.id, intentId))
    .limit(1))[0];

  if (!payment) return NextResponse.json({ error: "intent_not_found" }, { status: 404 });
  if (payment.status !== "authorized") {
    return NextResponse.json({ error: "intent_not_submittable", status: payment.status }, { status: 409 });
  }

  try {
    await verifySourceBurnTx({
      sourceChainId: payment.sourceChainId,
      burnTxHash: burnTxHash as Hex,
      expectedPayer: payment.payer,
      expectedAmount: BigInt(payment.sourceAmount),
      expectedDestinationDomain: payment.destinationDomain,
      expectedMintRecipient: payment.mintRecipient as Hex,
      expectedBurnToken: payment.sourceToken as Address,
    });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await recordCheckoutEvent({
      invoiceId: payment.invoiceId,
      crosschainPaymentId: payment.id,
      eventType: "crosschain_burn_rejected",
      sourceChainId: payment.sourceChainId,
      errorCode: error,
    });
    return NextResponse.json({ error }, { status: 400 });
  }

  await db.update(crosschainPayments)
    .set({
      status: "bridge_pending",
      burnTxHash,
      burnSubmittedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(crosschainPayments.id, intentId))
    .returning({ id: crosschainPayments.id });

  await recordCheckoutEvent({
    invoiceId: payment.invoiceId,
    crosschainPaymentId: payment.id,
    eventType: "crosschain_burn_submitted",
    sourceChainId: payment.sourceChainId,
  });

  return NextResponse.json({
    intentId,
    invoiceId: payment.invoiceId,
    status: "bridge_pending",
    statusUrl: `/api/checkout/crosschain/status/${intentId}`,
  }, { status: 202 });
}
```

- [ ] **Step 5: Run submit tests**

Run:

```bash
pnpm --filter @arcora/app test app/api/checkout/crosschain/submit/route.test.ts
pnpm --filter @arcora/app test lib/crosschain/receipt.test.ts
pnpm --filter @arcora/app typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit Task 4**

```bash
git add packages/app/lib/crosschain/receipt.ts packages/app/lib/crosschain/receipt.test.ts packages/app/app/api/checkout/crosschain/submit
git commit -m "feat(app): add cross-chain burn submission"
```

## Task 5: Add Cross-Chain Status API

**Files:**
- Create: `packages/app/app/api/checkout/crosschain/status/[id]/route.ts`
- Test: `packages/app/app/api/checkout/crosschain/status/[id]/route.test.ts`
- Modify: `packages/app/app/api/checkout/status/[id]/route.ts`

- [ ] **Step 1: Write failing cross-chain status route test**

Create `packages/app/app/api/checkout/crosschain/status/[id]/route.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { GET } from "./route";

vi.mock("@/lib/db/client", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [{
            id: "intent-1",
            invoiceId: "0x" + "1".repeat(64),
            status: "bridge_pending",
            sourceChainId: 84532,
            burnTxHash: "0x" + "b".repeat(64),
            bridgeReceiveTxHash: null,
            arcSwapTxHash: null,
            settleTxHash: null,
            lastError: null,
            updatedAt: new Date("2026-06-08T12:00:00Z"),
          }],
        }),
      }),
    }),
  },
}));

describe("GET /api/checkout/crosschain/status/[id]", () => {
  it("returns cross-chain payment status", async () => {
    const res = await GET(new Request("https://arcorapay.xyz") as any, {
      params: Promise.resolve({ id: "intent-1" }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe("bridge_pending");
    expect(body.burnTxHash).toMatch(/^0x/);
  });
});
```

- [ ] **Step 2: Run status test and verify it fails**

Run:

```bash
pnpm --filter @arcora/app test 'app/api/checkout/crosschain/status/[id]/route.test.ts'
```

Expected: FAIL because the route does not exist.

- [ ] **Step 3: Implement status route**

Create `packages/app/app/api/checkout/crosschain/status/[id]/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { crosschainPayments } from "@/lib/db/schema";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const row = (await db
    .select({
      id: crosschainPayments.id,
      invoiceId: crosschainPayments.invoiceId,
      status: crosschainPayments.status,
      sourceChainId: crosschainPayments.sourceChainId,
      burnTxHash: crosschainPayments.burnTxHash,
      bridgeReceiveTxHash: crosschainPayments.bridgeReceiveTxHash,
      arcSwapTxHash: crosschainPayments.arcSwapTxHash,
      settleTxHash: crosschainPayments.settleTxHash,
      lastError: crosschainPayments.lastError,
      updatedAt: crosschainPayments.updatedAt,
    })
    .from(crosschainPayments)
    .where(eq(crosschainPayments.id, id))
    .limit(1))[0];

  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({
    intentId: row.id,
    invoiceId: row.invoiceId,
    status: row.status,
    sourceChainId: row.sourceChainId,
    burnTxHash: row.burnTxHash,
    bridgeReceiveTxHash: row.bridgeReceiveTxHash,
    arcSwapTxHash: row.arcSwapTxHash,
    settleTxHash: row.settleTxHash,
    error: ["bridge_failed", "arc_swap_failed", "settle_failed"].includes(row.status) ? row.lastError : null,
    updatedAt: row.updatedAt.toISOString(),
  });
}
```

- [ ] **Step 4: Run status test**

Run:

```bash
pnpm --filter @arcora/app test 'app/api/checkout/crosschain/status/[id]/route.test.ts'
```

Expected: PASS.

- [ ] **Step 5: Commit Task 5**

```bash
git add packages/app/app/api/checkout/crosschain/status packages/app/app/api/checkout/status/[id]/route.ts
git commit -m "feat(app): expose cross-chain payment status"
```

## Task 6: Extract Arc Settlement Executor in Relayer

**Files:**
- Create: `ops/relayer/arc-settlement.ts`
- Test: `ops/relayer/arc-settlement.test.ts`
- Modify: `ops/relayer/tsconfig.json`
- Modify: `ops/relayer/run.ts`

- [ ] **Step 1: Write failing settlement executor tests**

Create `ops/relayer/arc-settlement.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { buildSettleArgs, tokenSymbolForArcAddress } from "./arc-settlement";

describe("arc settlement executor helpers", () => {
  it("maps Arc USDC and EURC addresses to App Kit symbols", () => {
    expect(tokenSymbolForArcAddress("0x3600000000000000000000000000000000000000")).toBe("USDC");
    expect(tokenSymbolForArcAddress("0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a")).toBe("EURC");
  });

  it("builds settleInvoice args with merchant payout invariant", () => {
    const args = buildSettleArgs({
      invoiceId: "0x" + "1".repeat(64),
      payer: "0x" + "a".repeat(40),
      payInToken: "0x3600000000000000000000000000000000000000",
      amountIn: 5_000_000n,
      grossPayout: 4_999_000n,
      swapTxHash: "0x" + "2".repeat(64),
    });

    expect(args[0]).toMatch(/^0x/);
    expect(args[3]).toBe(5_000_000n);
    expect(args[4]).toBe(4_999_000n);
  });
});
```

- [ ] **Step 2: Run settlement tests and verify they fail**

Run:

```bash
pnpm --filter arcora-relayer test arc-settlement.test.ts
```

Expected: FAIL because `arc-settlement.ts` does not exist.

- [ ] **Step 3: Implement settlement helper module**

Create `ops/relayer/arc-settlement.ts`:

```ts
import type { Address, Hex } from "viem";

export type ArcStableSymbol = "USDC" | "EURC";

const ARC_TOKEN_SYMBOL: Record<string, ArcStableSymbol> = {
  "0x3600000000000000000000000000000000000000": "USDC",
  "0x89b50855aa3be2f677cd6303cec089b5f319d72a": "EURC",
};

export function tokenSymbolForArcAddress(address: string): ArcStableSymbol {
  const symbol = ARC_TOKEN_SYMBOL[address.toLowerCase()];
  if (!symbol) throw new Error(`unknown Arc stable token: ${address}`);
  return symbol;
}

export function buildSettleArgs(args: {
  invoiceId: string;
  payer: string;
  payInToken: string;
  amountIn: bigint;
  grossPayout: bigint;
  swapTxHash: Hex;
}): [Hex, Address, Address, bigint, bigint, Hex] {
  return [
    args.invoiceId as Hex,
    args.payer as Address,
    args.payInToken as Address,
    args.amountIn,
    args.grossPayout,
    args.swapTxHash,
  ];
}
```

- [ ] **Step 4: Include new files in relayer tsconfig**

Modify `ops/relayer/tsconfig.json` include:

```json
{
  "include": [
    "smoke.ts",
    "smoke-crosschain.ts",
    "run.ts",
    "replay.ts",
    "vault-signer.ts",
    "vault-signer.test.ts",
    "gateway-allowlist.ts",
    "gateway-allowlist.test.ts",
    "db.ts",
    "db.test.ts",
    "arc-settlement.ts",
    "arc-settlement.test.ts",
    "cctp.ts",
    "cctp.test.ts",
    "crosschain-types.ts",
    "crosschain-worker.ts",
    "crosschain-worker.test.ts",
    "e2e-test.ts",
    "e2e-twowallet.ts"
  ]
}
```

- [ ] **Step 5: Run settlement tests and typecheck**

Run:

```bash
pnpm --filter arcora-relayer test arc-settlement.test.ts
pnpm --filter arcora-relayer typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit Task 6**

```bash
git add ops/relayer/arc-settlement.ts ops/relayer/arc-settlement.test.ts ops/relayer/tsconfig.json
git commit -m "feat(relayer): add reusable Arc settlement helpers"
```

## Task 7: Add CCTP IRIS and Destination Receive Adapter

**Files:**
- Create: `ops/relayer/cctp.ts`
- Test: `ops/relayer/cctp.test.ts`
- Modify: `ops/relayer/package.json`

- [ ] **Step 1: Write failing CCTP tests**

Create `ops/relayer/cctp.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { buildIrisMessagesUrl, parseIrisAttestation, receiveMessageCall } from "./cctp";

describe("CCTP adapter", () => {
  it("builds Circle IRIS v2 message URL", () => {
    expect(buildIrisMessagesUrl({
      irisBaseUrl: "https://iris-api-sandbox.circle.com",
      sourceDomain: 6,
      burnTxHash: "0x" + "b".repeat(64),
    })).toBe(`https://iris-api-sandbox.circle.com/v2/messages/6?transactionHash=${"0x" + "b".repeat(64)}`);
  });

  it("parses complete attestation response", () => {
    const att = parseIrisAttestation({
      messages: [{ status: "complete", message: "0x1234", attestation: "0xabcd" }],
    });
    expect(att.message).toBe("0x1234");
    expect(att.attestation).toBe("0xabcd");
  });

  it("builds receiveMessage call payload", () => {
    const call = receiveMessageCall({
      messageTransmitter: "0x" + "1".repeat(40),
      message: "0x1234",
      attestation: "0xabcd",
    });
    expect(call.functionName).toBe("receiveMessage");
    expect(call.args).toEqual(["0x1234", "0xabcd"]);
  });
});
```

- [ ] **Step 2: Run CCTP tests and verify they fail**

Run:

```bash
pnpm --filter arcora-relayer test cctp.test.ts
```

Expected: FAIL because `cctp.ts` does not exist.

- [ ] **Step 3: Implement CCTP adapter**

Create `ops/relayer/cctp.ts`:

```ts
import { parseAbi, type Address, type Hex } from "viem";

export const MESSAGE_TRANSMITTER_ABI = parseAbi([
  "function receiveMessage(bytes message, bytes attestation) returns (bool)",
]);

export interface IrisAttestation {
  message: Hex;
  attestation: Hex;
}

export function buildIrisMessagesUrl(args: {
  irisBaseUrl: string;
  sourceDomain: number;
  burnTxHash: Hex;
}): string {
  const base = args.irisBaseUrl.replace(/\/$/, "");
  return `${base}/v2/messages/${args.sourceDomain}?transactionHash=${args.burnTxHash}`;
}

export function parseIrisAttestation(body: unknown): IrisAttestation | null {
  const messages = (body as { messages?: unknown[] })?.messages;
  const first = Array.isArray(messages) ? messages[0] as any : null;
  if (!first || first.status !== "complete") return null;
  if (typeof first.message !== "string" || typeof first.attestation !== "string") return null;
  return { message: first.message as Hex, attestation: first.attestation as Hex };
}

export async function fetchIrisAttestation(args: {
  irisBaseUrl: string;
  sourceDomain: number;
  burnTxHash: Hex;
  fetchImpl?: typeof fetch;
}): Promise<IrisAttestation | null> {
  const doFetch = args.fetchImpl ?? fetch;
  const res = await doFetch(buildIrisMessagesUrl(args));
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`iris_request_failed:${res.status}`);
  return parseIrisAttestation(await res.json());
}

export function receiveMessageCall(args: {
  messageTransmitter: Address;
  message: Hex;
  attestation: Hex;
}) {
  return {
    address: args.messageTransmitter,
    abi: MESSAGE_TRANSMITTER_ABI,
    functionName: "receiveMessage" as const,
    args: [args.message, args.attestation] as const,
  };
}
```

- [ ] **Step 4: Run CCTP tests**

Run:

```bash
pnpm --filter arcora-relayer test cctp.test.ts
pnpm --filter arcora-relayer typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit Task 7**

```bash
git add ops/relayer/cctp.ts ops/relayer/cctp.test.ts ops/relayer/package.json
git commit -m "feat(relayer): add CCTP attestation adapter"
```

## Task 8: Add Cross-Chain Worker State Machine

**Files:**
- Create: `ops/relayer/crosschain-types.ts`
- Create: `ops/relayer/crosschain-worker.ts`
- Test: `ops/relayer/crosschain-worker.test.ts`
- Modify: `ops/relayer/package.json`
- Modify: `ops/relayer/run.ts`

- [ ] **Step 1: Write failing worker tests**

Create `ops/relayer/crosschain-worker.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { processCrosschainPayment } from "./crosschain-worker";
import type { CrosschainPaymentRow, CrosschainWorkerDeps } from "./crosschain-types";

const baseRow: CrosschainPaymentRow = {
  id: "intent-1",
  invoice_id: "0x" + "1".repeat(64),
  payer: "0x" + "a".repeat(40),
  source_chain_id: 84532,
  source_domain: 6,
  source_token: "0x" + "2".repeat(40),
  source_amount: "5000000",
  destination_chain_id: 5042002,
  destination_domain: 30,
  destination_token: "0x3600000000000000000000000000000000000000",
  payout_token: "0x3600000000000000000000000000000000000000",
  amount_out_min: "5000000",
  status: "bridge_pending",
  burn_tx_hash: "0x" + "b".repeat(64),
  cctp_message: null,
  cctp_attestation: null,
  bridge_receive_tx_hash: null,
  bridge_amount_received: null,
  arc_swap_tx_hash: null,
  arc_swap_amount_out: null,
  settle_tx_hash: null,
  attempts: 1,
  last_error: null,
};

function deps(): CrosschainWorkerDeps {
  return {
    fetchAttestation: vi.fn(async () => ({ message: "0x1234", attestation: "0xabcd" })),
    receiveMessage: vi.fn(async () => ({
      txHash: "0x" + "3".repeat(64),
      amountReceived: 5_000_000n,
    })),
    swapOnArc: vi.fn(async () => ({ amountOut: 5_000_000n, txHash: "0x" + "4".repeat(64) })),
    settleOnArc: vi.fn(async () => "0x" + "5".repeat(64)),
    refundOnArc: vi.fn(async () => "0x" + "6".repeat(64)),
    mark: vi.fn(async () => {}),
    fail: vi.fn(async () => {}),
  };
}

describe("processCrosschainPayment", () => {
  it("moves bridge_pending through receiveMessage and settle for USDC payout", async () => {
    const d = deps();
    await processCrosschainPayment(baseRow, d);

    expect(d.fetchAttestation).toHaveBeenCalled();
    expect(d.receiveMessage).toHaveBeenCalled();
    expect(d.swapOnArc).not.toHaveBeenCalled();
    expect(d.settleOnArc).toHaveBeenCalledWith(expect.objectContaining({
      grossPayout: 5_000_000n,
      swapTxHash: "0x" + "3".repeat(64),
    }));
  });

  it("uses Arc swap before settle for EURC payout", async () => {
    const d = deps();
    await processCrosschainPayment({
      ...baseRow,
      payout_token: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a",
    }, d);

    expect(d.swapOnArc).toHaveBeenCalled();
    expect(d.settleOnArc).toHaveBeenCalledWith(expect.objectContaining({
      grossPayout: 5_000_000n,
      swapTxHash: "0x" + "4".repeat(64),
    }));
  });

  it("refunds bridged Arc USDC to the payer when the received amount is below the invoice minimum", async () => {
    const d = deps();
    vi.mocked(d.receiveMessage).mockResolvedValue({
      txHash: "0x" + "3".repeat(64),
      amountReceived: 4_900_000n,
    });

    await processCrosschainPayment(baseRow, d);

    expect(d.refundOnArc).toHaveBeenCalledWith(expect.objectContaining({
      amount: 4_900_000n,
      token: baseRow.destination_token,
    }));
    expect(d.mark).toHaveBeenCalledWith(baseRow.id, expect.objectContaining({
      status: "refunded",
      refund_tx_hash: "0x" + "6".repeat(64),
    }));
    expect(d.settleOnArc).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run worker tests and verify they fail**

Run:

```bash
pnpm --filter arcora-relayer test crosschain-worker.test.ts
```

Expected: FAIL because worker files do not exist.

- [ ] **Step 3: Implement worker types**

First add the shared state-machine package to `ops/relayer/package.json`:

```json
{
  "dependencies": {
    "@arcora/crosschain-core": "workspace:*"
  }
}
```

Run `pnpm install` from the repository root so `pnpm-lock.yaml` records both the app and relayer workspace dependencies.

Create `ops/relayer/crosschain-types.ts`:

```ts
import type { Hex } from "viem";
import type { CrosschainState } from "@arcora/crosschain-core";

export interface CrosschainPaymentRow {
  id: string;
  invoice_id: string;
  payer: string;
  source_chain_id: number;
  source_domain: number;
  source_token: string;
  source_amount: string;
  destination_chain_id: number;
  destination_domain: number;
  destination_token: string;
  payout_token: string;
  amount_out_min: string;
  status: CrosschainState;
  burn_tx_hash: string | null;
  cctp_message: string | null;
  cctp_attestation: string | null;
  bridge_receive_tx_hash: string | null;
  bridge_amount_received: string | null;
  arc_swap_tx_hash: string | null;
  arc_swap_amount_out: string | null;
  settle_tx_hash: string | null;
  attempts: number;
  last_error: string | null;
}

export interface CrosschainWorkerDeps {
  fetchAttestation(row: CrosschainPaymentRow): Promise<{ message: Hex; attestation: Hex } | null>;
  receiveMessage(
    row: CrosschainPaymentRow,
    attestation: { message: Hex; attestation: Hex },
    onBroadcast: (txHash: Hex) => Promise<void>,
  ): Promise<{ txHash: Hex; amountReceived: bigint }>;
  swapOnArc(row: CrosschainPaymentRow): Promise<{ amountOut: bigint; txHash: Hex }>;
  settleOnArc(args: {
    row: CrosschainPaymentRow;
    grossPayout: bigint;
    swapTxHash: Hex;
  }): Promise<Hex>;
  refundOnArc(args: {
    row: CrosschainPaymentRow;
    token: string;
    amount: bigint;
  }): Promise<Hex>;
  mark(id: string, values: Record<string, unknown>): Promise<void>;
  fail(id: string, status: CrosschainState, error: string): Promise<void>;
}
```

- [ ] **Step 4: Implement worker state machine**

Create `ops/relayer/crosschain-worker.ts`:

```ts
import type { Hex } from "viem";
import type { CrosschainState } from "@arcora/crosschain-core";
import type { CrosschainPaymentRow, CrosschainWorkerDeps } from "./crosschain-types";

const ZERO_HASH = "0x0000000000000000000000000000000000000000000000000000000000000000" as Hex;

function payoutIsBridgedUsdc(row: CrosschainPaymentRow): boolean {
  return row.payout_token.toLowerCase() === row.destination_token.toLowerCase();
}

export async function processCrosschainPayment(
  row: CrosschainPaymentRow,
  deps: CrosschainWorkerDeps,
): Promise<void> {
  let failureState: CrosschainState = "bridge_failed";
  try {
    let bridgeTx = row.bridge_receive_tx_hash as Hex | null;
    let bridgeAmountReceived = row.bridge_amount_received
      ? BigInt(row.bridge_amount_received)
      : null;
    if (!bridgeTx || bridgeAmountReceived === null) {
      const att = row.cctp_message && row.cctp_attestation
        ? { message: row.cctp_message as Hex, attestation: row.cctp_attestation as Hex }
        : await deps.fetchAttestation(row);

      if (!att) {
        await deps.mark(row.id, {
          status: "bridge_pending",
          next_attempt: new Date(Date.now() + 15_000),
          updated_at: new Date(),
        });
        return;
      }

      await deps.mark(row.id, {
        cctp_message: att.message,
        cctp_attestation: att.attestation,
        status: "bridge_confirmed",
        updated_at: new Date(),
      });

      failureState = "bridge_failed";
      const received = await deps.receiveMessage(row, att, async (txHash) => {
        bridgeTx = txHash;
        await deps.mark(row.id, {
          bridge_receive_tx_hash: txHash,
          updated_at: new Date(),
        });
      });
      bridgeTx = received.txHash;
      bridgeAmountReceived = received.amountReceived;
      await deps.mark(row.id, {
        bridge_receive_tx_hash: bridgeTx,
        bridge_amount_received: bridgeAmountReceived.toString(),
        bridge_confirmed_at: new Date(),
        status: payoutIsBridgedUsdc(row) ? "settle_pending" : "arc_swap_pending",
        updated_at: new Date(),
      });
    }

    if (bridgeAmountReceived === null) {
      throw new Error("bridge_amount_missing");
    }

    let grossPayout = bridgeAmountReceived;
    let swapTxHash = bridgeTx ?? ZERO_HASH;

    if (!payoutIsBridgedUsdc(row)) {
      failureState = "arc_swap_failed";
      if (row.arc_swap_tx_hash && row.arc_swap_amount_out) {
        grossPayout = BigInt(row.arc_swap_amount_out);
        swapTxHash = row.arc_swap_tx_hash as Hex;
      } else {
        const swap = await deps.swapOnArc(row);
        grossPayout = swap.amountOut;
        swapTxHash = swap.txHash;
        await deps.mark(row.id, {
          arc_swap_tx_hash: swap.txHash,
          arc_swap_amount_out: swap.amountOut.toString(),
          status: "settle_pending",
          updated_at: new Date(),
        });
      }
    }

    if (grossPayout < BigInt(row.amount_out_min)) {
      if (payoutIsBridgedUsdc(row)) {
        const refundTx = await deps.refundOnArc({
          row,
          token: row.destination_token,
          amount: grossPayout,
        });
        await deps.mark(row.id, {
          refund_tx_hash: refundTx,
          status: "refunded",
          last_error: `payout shortfall: ${grossPayout} < ${row.amount_out_min}`,
          updated_at: new Date(),
        });
        return;
      }
      await deps.fail(row.id, "arc_swap_failed", `payout shortfall: ${grossPayout} < ${row.amount_out_min}`);
      return;
    }

    failureState = "settle_failed";
    const settleTx = await deps.settleOnArc({ row, grossPayout, swapTxHash });
    await deps.mark(row.id, {
      settle_tx_hash: settleTx,
      status: "paid",
      updated_at: new Date(),
    });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await deps.fail(row.id, failureState, error);
  }
}
```

- [ ] **Step 5: Run worker tests**

Run:

```bash
pnpm --filter arcora-relayer test crosschain-worker.test.ts
pnpm --filter arcora-relayer typecheck
```

Expected: PASS.

- [ ] **Step 6: Wire worker into daemon loop**

Modify `ops/relayer/run.ts`:

1. Import the worker and CCTP adapter.
2. Add `claimNextCrosschain()` that claims `crosschain_payments` rows in `bridge_pending`, `bridge_confirmed`, `arc_swap_pending`, or `settle_pending`.
3. In the main tick, process one cross-chain row first, then fall back to the existing Arc-only `relayer_queue`.

Use this SQL shape for claim:

```ts
async function claimNextCrosschain(): Promise<CrosschainPaymentRow | null> {
  const res = await pool.query<CrosschainPaymentRow>(`
    with claimed as (
      update crosschain_payments
         set attempts = attempts + 1,
             lease_owner = $1,
             lease_expires_at = now() + ($2 || ' seconds')::interval,
             updated_at = now()
       where id = (
         select id from crosschain_payments
          where status in ('bridge_pending', 'bridge_confirmed', 'arc_swap_pending', 'settle_pending')
            and next_attempt <= now()
            and (lease_expires_at is null or lease_expires_at < now())
          order by next_attempt
          limit 1
          for update skip locked
       )
       returning *
    )
    select * from claimed
  `, [RELAYER_ADDR, String(LEASE_SECONDS)]);
  return res.rows[0] ?? null;
}
```

Implement the dependency wiring with these accounting rules:

1. `receiveMessage` reads the relayer's Arc USDC balance immediately before the call, submits `receiveMessage(message, attestation)`, waits for a successful receipt, reads the balance again, and returns `{ txHash, amountReceived: after - before }`. Reject zero or negative deltas.
2. `refundOnArc` calls ERC-20 `transfer(row.payer, amount)` on Arc, waits for a successful receipt, and returns the transaction hash. This Q1 refund lands on the customer's same EVM address on Arc, not back on the source chain; the checkout UI and runbook must disclose that behavior.
3. `fail` retries transient bridge, RPC, IRIS, swap, and settlement errors with capped exponential backoff. Before `CROSSCHAIN_MAX_ATTEMPTS` it preserves the current processable status and updates `last_error`, `next_attempt`, and clears the lease. Only after the cap does it write `bridge_failed`, `arc_swap_failed`, or `settle_failed`.
4. Never auto-refund after an EURC swap has completed. A post-swap shortfall or settlement failure remains `arc_swap_failed`/`settle_failed` for operator recovery because returning the original source-chain asset would require a reverse swap plus reverse CCTP route.
5. Clear `lease_owner` and `lease_expires_at` after every successful state transition, retry schedule, terminal failure, or refund.

Use receipt log parsing rather than a process-local balance delta so a daemon restart can reconstruct the received amount:

```ts
import { parseEventLogs } from "viem";
import { chainById, parseChainRegistryJson } from "@arcora/crosschain-core";
import { receiveMessageCall } from "./cctp";

const TRANSFER_EVENT = parseAbi([
  "event Transfer(address indexed from,address indexed to,uint256 value)",
]);
const crosschainRegistry = parseChainRegistryJson(need("CROSSCHAIN_CHAIN_CONFIG_JSON"));

async function receiveCrosschainMessage(
  row: CrosschainPaymentRow,
  att: { message: Hex; attestation: Hex },
  onBroadcast: (txHash: Hex) => Promise<void>,
): Promise<{ txHash: Hex; amountReceived: bigint }> {
  const txHash = row.bridge_receive_tx_hash as Hex | null
    ?? await wallet.writeContract(receiveMessageCall({
      messageTransmitter: chainById(
        crosschainRegistry,
        row.destination_chain_id,
      ).messageTransmitter,
      message: att.message,
      attestation: att.attestation,
    }));

  if (!row.bridge_receive_tx_hash) await onBroadcast(txHash);

  const receipt = await chain.waitForTransactionReceipt({
    hash: txHash,
    timeout: RECEIPT_TIMEOUT_MS,
  });
  if (receipt.status !== "success") throw new Error("cctp_receive_reverted");

  const transfers = parseEventLogs({
    abi: TRANSFER_EVENT,
    eventName: "Transfer",
    logs: receipt.logs,
    strict: false,
  });
  const mint = transfers.find((event) =>
    event.address.toLowerCase() === row.destination_token.toLowerCase()
    && event.args.from?.toLowerCase() === "0x0000000000000000000000000000000000000000"
    && event.args.to?.toLowerCase() === RELAYER_ADDR.toLowerCase(),
  );
  if (!mint?.args.value || mint.args.value <= 0n) {
    throw new Error("cctp_receive_mint_event_missing");
  }

  return { txHash, amountReceived: mint.args.value };
}
```

Implement Arc-side refund with the same persist-before-wait discipline:

```ts
async function refundCrosschainOnArc(args: {
  row: CrosschainPaymentRow;
  token: string;
  amount: bigint;
}): Promise<Hex> {
  const txHash = await wallet.writeContract({
    address: args.token as Address,
    abi: ERC20,
    functionName: "transfer",
    args: [args.row.payer as Address, args.amount],
  });
  await markCrosschain(args.row.id, { refund_tx_hash: txHash });
  const receipt = await chain.waitForTransactionReceipt({
    hash: txHash,
    timeout: RECEIPT_TIMEOUT_MS,
  });
  if (receipt.status !== "success") throw new Error("crosschain_refund_reverted");
  return txHash;
}
```

Add to `ops/relayer/.env.example` in Task 10:

```bash
CROSSCHAIN_MAX_ATTEMPTS=12
CROSSCHAIN_RETRY_BASE_MS=15000
CROSSCHAIN_RETRY_MAX_MS=900000
```

- [ ] **Step 7: Commit Task 8**

```bash
git add ops/relayer/package.json pnpm-lock.yaml ops/relayer/crosschain-types.ts ops/relayer/crosschain-worker.ts ops/relayer/crosschain-worker.test.ts ops/relayer/run.ts
git commit -m "feat(relayer): process cross-chain payment state machine"
```

## Task 9: Add Checkout UI Cross-Chain Flow

**Files:**
- Modify: `packages/app/lib/chain/wagmi-config.tsx`
- Modify: `packages/app/.env.example`
- Create: `packages/app/components/checkout/ChainSelector.tsx`
- Create: `packages/app/components/checkout/CrossChainPayButton.tsx`
- Test: `packages/app/components/checkout/CrossChainPayButton.test.tsx`
- Modify: `packages/app/app/i/[invoiceId]/CheckoutClient.tsx`

- [ ] **Step 1: Add supported source chains to wagmi**

Update `packages/app/lib/chain/wagmi-config.tsx` while preserving the existing connectors and Arc chain definition:

```tsx
import { baseSepolia, sepolia } from "viem/chains";

export const wagmiConfig = createConfig({
  chains: [arcTestnet, baseSepolia, sepolia],
  connectors: [injected()],
  transports: {
    [arcTestnet.id]: http(),
    [baseSepolia.id]: http(process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL),
    [sepolia.id]: http(process.env.NEXT_PUBLIC_ETHEREUM_SEPOLIA_RPC_URL),
  },
  ssr: true,
});
```

Add to `packages/app/.env.example`:

```bash
NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL=
NEXT_PUBLIC_ETHEREUM_SEPOLIA_RPC_URL=
```

Production deployments must provide both RPC URLs; do not silently fall back to shared public endpoints.

- [ ] **Step 2: Write failing UI test**

Create `packages/app/components/checkout/CrossChainPayButton.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CrossChainPayButton } from "./CrossChainPayButton";

vi.mock("wagmi", () => ({
  useAccount: () => ({ address: "0x" + "a".repeat(40), isConnected: true }),
  useChainId: () => 84532,
  useSwitchChain: () => ({ switchChainAsync: vi.fn() }),
  useWriteContract: () => ({
    writeContractAsync: vi.fn().mockResolvedValue("0x" + "b".repeat(64)),
  }),
  usePublicClient: () => ({
    readContract: vi.fn().mockResolvedValue(0n),
    waitForTransactionReceipt: vi.fn(),
  }),
}));

describe("CrossChainPayButton", () => {
  it("renders source chain and bridge action", () => {
    render(
      <CrossChainPayButton
        invoiceId={"0x" + "1".repeat(64)}
        sourceChainId={84532}
        onPaid={vi.fn()}
        onFailed={vi.fn()}
      />,
    );
    expect(screen.getByRole("button")).toHaveTextContent(/Bridge USDC from Base/i);
  });
});
```

- [ ] **Step 3: Run UI test and verify it fails**

Run:

```bash
pnpm --filter @arcora/app test components/checkout/CrossChainPayButton.test.tsx
```

Expected: FAIL because the component does not exist.

- [ ] **Step 4: Implement chain selector**

Create `packages/app/components/checkout/ChainSelector.tsx`:

```tsx
"use client";

const CHAINS = [
  { chainId: 84532, label: "Base Sepolia" },
  { chainId: 11155111, label: "Ethereum Sepolia" },
] as const;

export function ChainSelector(props: {
  value: number;
  onChange: (chainId: number) => void;
}) {
  return (
    <label className="block space-y-2">
      <span className="text-sm font-medium">Pay from</span>
      <select
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
        className="w-full border border-arcora-border bg-white px-3 py-2 text-sm"
      >
        {CHAINS.map((chain) => (
          <option key={chain.chainId} value={chain.chainId}>{chain.label}</option>
        ))}
      </select>
    </label>
  );
}

export function chainLabel(chainId: number): string {
  return CHAINS.find((chain) => chain.chainId === chainId)?.label ?? `chain ${chainId}`;
}
```

- [ ] **Step 5: Implement cross-chain pay button**

Create `packages/app/components/checkout/CrossChainPayButton.tsx`:

```tsx
"use client";

import { useState } from "react";
import { parseAbi, type Address, type Hex } from "viem";
import {
  useAccount,
  useChainId,
  usePublicClient,
  useSwitchChain,
  useWriteContract,
} from "wagmi";
import { toast } from "sonner";
import { chainLabel } from "./ChainSelector";

const TOKEN_MESSENGER_ABI = parseAbi([
  "function depositForBurn(uint256 amount,uint32 destinationDomain,bytes32 mintRecipient,address burnToken,bytes32 hookData,uint256 maxFee,uint32 finalityThreshold)",
]);

const ERC20_ABI = parseAbi([
  "function allowance(address owner,address spender) view returns (uint256)",
  "function approve(address spender,uint256 amount) returns (bool)",
]);

type State =
  | "idle"
  | "preparing"
  | "switching"
  | "approving"
  | "burning"
  | "submitted"
  | "settling"
  | "success"
  | "failed";

export function CrossChainPayButton(props: {
  invoiceId: string;
  sourceChainId: number;
  onPaid: (tx: Hex) => void;
  onFailed?: (reason: string) => void;
}) {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient({ chainId: props.sourceChainId });
  const [state, setState] = useState<State>("idle");

  async function poll(url: string): Promise<any> {
    for (let i = 0; i < 72; i++) {
      const res = await fetch(url);
      const body = await res.json();
      if (["paid", "bridge_failed", "arc_swap_failed", "settle_failed", "refunded", "expired"].includes(body.status)) {
        return body;
      }
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
    throw new Error("timed out waiting for cross-chain settlement");
  }

  async function handleClick() {
    if (!address) return;
    try {
      setState("preparing");
      const prepareRes = await fetch("/api/checkout/crosschain/prepare", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ invoiceId: props.invoiceId, payer: address, sourceChainId: props.sourceChainId }),
      });
      const prepare = await prepareRes.json();
      if (!prepareRes.ok) throw new Error(prepare.error ?? "prepare failed");

      if (chainId !== props.sourceChainId) {
        setState("switching");
        await switchChainAsync({ chainId: props.sourceChainId });
      }
      if (!publicClient) throw new Error("source-chain client unavailable");

      const amount = BigInt(prepare.depositForBurn.amount);
      const burnToken = prepare.depositForBurn.burnToken as Address;
      const tokenMessenger = prepare.depositForBurn.tokenMessenger as Address;
      const allowance = await publicClient.readContract({
        address: burnToken,
        abi: ERC20_ABI,
        functionName: "allowance",
        args: [address, tokenMessenger],
      });

      if (allowance < amount) {
        setState("approving");
        const approvalTx = await writeContractAsync({
          chainId: props.sourceChainId,
          address: burnToken,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [tokenMessenger, amount],
        });
        await publicClient.waitForTransactionReceipt({ hash: approvalTx });
      }

      setState("burning");
      const tx = await writeContractAsync({
        chainId: props.sourceChainId,
        address: tokenMessenger,
        abi: TOKEN_MESSENGER_ABI,
        functionName: "depositForBurn",
        args: [
          amount,
          prepare.depositForBurn.destinationDomain,
          prepare.depositForBurn.mintRecipient as Hex,
          burnToken,
          "0x0000000000000000000000000000000000000000000000000000000000000000",
          BigInt(prepare.depositForBurn.maxFee),
          prepare.depositForBurn.finalityThreshold,
        ],
      });
      await publicClient?.waitForTransactionReceipt({ hash: tx });

      setState("submitted");
      const submitRes = await fetch("/api/checkout/crosschain/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ intentId: prepare.intentId, burnTxHash: tx }),
      });
      const submitted = await submitRes.json();
      if (!submitRes.ok) throw new Error(submitted.error ?? "submit failed");

      setState("settling");
      const terminal = await poll(submitted.statusUrl);
      if (terminal.status === "paid" && terminal.settleTxHash) {
        setState("success");
        props.onPaid(terminal.settleTxHash);
      } else {
        setState("failed");
        const reason = terminal.error ?? `cross-chain payment failed: ${terminal.status}`;
        toast.error(reason);
        props.onFailed?.(reason);
      }
    } catch (e) {
      setState("failed");
      const reason = e instanceof Error ? e.message : String(e);
      toast.error(reason);
      props.onFailed?.(reason);
    }
  }

  const busy = ["preparing", "switching", "approving", "burning", "submitted", "settling"].includes(state);
  const label =
    state === "preparing" ? "Preparing route..." :
    state === "switching" ? "Switching network..." :
    state === "approving" ? "Approving USDC..." :
    state === "burning" ? "Confirm bridge transaction..." :
    state === "submitted" ? "Submitting bridge proof..." :
    state === "settling" ? "Waiting for Arc settlement..." :
    state === "success" ? "Paid ✓" :
    `Bridge USDC from ${chainLabel(props.sourceChainId)}`;

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={!isConnected || !address || busy || state === "success"}
      className="btn-arcora-pill w-full"
      aria-busy={busy || undefined}
    >
      {label}
    </button>
  );
}
```

- [ ] **Step 6: Wire into CheckoutClient**

Modify `packages/app/app/i/[invoiceId]/CheckoutClient.tsx`:

- Add `useState(84532)` for selected source chain.
- Render `ChainSelector` above payment actions when `NEXT_PUBLIC_CROSSCHAIN_ENABLED === "true"`.
- Render `CrossChainPayButton` for cross-chain mode.
- Keep existing `PayButton` visible as "Pay on Arc" so the old flow remains available.
- Under the cross-chain action, render: `If bridging completes but settlement cannot proceed before a swap, any automatic refund is sent as USDC to this same address on Arc.`

Use this import block:

```tsx
import { ChainSelector } from "@/components/checkout/ChainSelector";
import { CrossChainPayButton } from "@/components/checkout/CrossChainPayButton";
```

- [ ] **Step 7: Run UI tests**

Run:

```bash
pnpm --filter @arcora/app test components/checkout/CrossChainPayButton.test.tsx
pnpm --filter @arcora/app test components/checkout/StatusScreens.test.tsx
pnpm --filter @arcora/app typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit Task 9**

```bash
git add packages/app/lib/chain/wagmi-config.tsx packages/app/.env.example packages/app/components/checkout packages/app/app/i/[invoiceId]/CheckoutClient.tsx
git commit -m "feat(app): add cross-chain checkout UI"
```

## Task 10: Add Relayer Smoke Script and Runbook

**Files:**
- Create: `ops/relayer/smoke-crosschain.ts`
- Modify: `ops/relayer/package.json`
- Modify: `ops/relayer/.env.example`
- Create: `docs/runbooks/crosschain-v2-demo.md`
- Modify: `README.md`

- [ ] **Step 1: Add smoke script command**

Modify `ops/relayer/package.json`:

```json
{
  "scripts": {
    "smoke": "tsx --env-file-if-exists=.env smoke.ts",
    "smoke:crosschain": "tsx --env-file-if-exists=.env smoke-crosschain.ts",
    "start": "tsx run.ts",
    "replay": "tsx replay.ts",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  }
}
```

- [ ] **Step 2: Add relayer env docs**

Append to `ops/relayer/.env.example`:

```bash
# Cross-chain v2 Q1
CROSSCHAIN_ENABLED=true
CROSSCHAIN_ENABLED_SOURCE_CHAINS=84532,11155111
CROSSCHAIN_CHAIN_CONFIG_JSON=
CCTP_IRIS_API_URL=https://iris-api-sandbox.circle.com
CROSSCHAIN_MAX_ATTEMPTS=12
CROSSCHAIN_RETRY_BASE_MS=15000
CROSSCHAIN_RETRY_MAX_MS=900000
BASE_SEPOLIA_RPC=
ETHEREUM_SEPOLIA_RPC=
ARBITRUM_SEPOLIA_RPC=
OPTIMISM_SEPOLIA_RPC=
POLYGON_AMOY_RPC=
AVALANCHE_FUJI_RPC=
LINEA_SEPOLIA_RPC=
```

- [ ] **Step 3: Create smoke script**

Create `ops/relayer/smoke-crosschain.ts`:

```ts
import pg from "pg";
import { buildOpsPoolConfig, assertSecureDbTls } from "./db.js";

const pgUrl = process.env.POSTGRES_URL_NON_POOLING;
if (!pgUrl) throw new Error("missing POSTGRES_URL_NON_POOLING");

const cfg = buildOpsPoolConfig(pgUrl);
assertSecureDbTls(cfg);
const pool = new pg.Pool(cfg);

const rows = await pool.query(`
  select status, count(*)::int as count
    from crosschain_payments
   group by status
   order by status
`);

console.log(JSON.stringify({
  ok: true,
  crosschainPaymentsByStatus: rows.rows,
}, null, 2));

await pool.end();
```

- [ ] **Step 4: Create runbook**

Create `docs/runbooks/crosschain-v2-demo.md`:

```md
# Cross-Chain v2 Demo Runbook

## Goal

Demonstrate Base Sepolia or Ethereum Sepolia USDC payment into Arc Testnet,
followed by Arc-side settlement into the merchant payout token.

## Preconditions

- Arcora app deployed with `NEXT_PUBLIC_CROSSCHAIN_ENABLED=true`.
- Relayer deployed with `CROSSCHAIN_ENABLED=true`.
- `CROSSCHAIN_ENABLED_SOURCE_CHAINS=84532,11155111`.
- `CROSSCHAIN_CHAIN_CONFIG_JSON` contains verified non-zero CCTP domains,
  TokenMessenger addresses, MessageTransmitter addresses, and USDC addresses
  for Arc Testnet, Base Sepolia, and Ethereum Sepolia.
- Source-chain RPC envs are configured.
- `CCTP_IRIS_API_URL=https://iris-api-sandbox.circle.com`.
- Relayer wallet has Arc gas balance and can call `receiveMessage`.
- Customer wallet has source-chain USDC and gas.

## Demo Steps

1. Merchant creates an invoice from `/m/dashboard`.
2. Customer opens `/i/<invoiceId>`.
3. Customer selects Base Sepolia or Ethereum Sepolia.
4. Customer clicks `Bridge USDC from <chain>`.
5. Wallet sends `depositForBurn` to the source TokenMessenger.
6. App submits the burn tx hash to `/api/checkout/crosschain/submit`.
7. Relayer polls IRIS for attestation.
8. Relayer calls Arc `receiveMessage`.
9. Relayer swaps Arc USDC to merchant payout token when payout is not USDC.
10. Relayer calls `settleInvoice`.
11. Checkout status becomes `paid`.

## Verification Commands

```bash
pnpm --filter @arcora/crosschain-core test
pnpm --filter @arcora/app test app/api/checkout/crosschain/prepare/route.test.ts
pnpm --filter @arcora/app test app/api/checkout/crosschain/submit/route.test.ts
pnpm --filter arcora-relayer test cctp.test.ts crosschain-worker.test.ts arc-settlement.test.ts
pnpm --filter arcora-relayer smoke:crosschain
```

## Failure Interpretation

- `source_chain_disabled`: source chain is not enabled in `CROSSCHAIN_ENABLED_SOURCE_CHAINS`.
- `burn_tx_wrong_token_messenger`: submitted burn tx did not target the configured CCTP TokenMessenger.
- `iris_request_failed:<status>`: Circle IRIS returned an unexpected HTTP status.
- `payout shortfall`: bridge/swap delivered less than `amountOutMin`; do not settle.
- `settle_failed`: operator must inspect `crosschain_payments.last_error`.

## Refund Policy

- If Arc receives less USDC than `amountOutMin` and no Arc swap has occurred, the relayer transfers the received Arc USDC to the payer's same EVM address and marks the payment `refunded`.
- The UI must state that this Q1 automatic refund is delivered on Arc, not the original source chain.
- Once an Arc USDC-to-EURC swap has executed, automatic refund is disabled. Operators recover from the recorded bridge, swap, and settlement transaction hashes to avoid an unsafe or lossy implicit reverse route.
- A burn awaiting Circle attestation is retried, not refunded or marked failed merely because IRIS is slow.
```

- [ ] **Step 5: Update README roadmap note**

Add this line under the v2.0 roadmap paragraph in `README.md`:

```md
Q1 v2.0 implementation plan lives at `docs/superpowers/plans/2026-06-08-q1-cross-chain-v2-code-spine.md`; it starts with Base/Ethereum demo routes, keeps source-chain expansion behind feature flags, and preserves the merchant payout-token invariant.
```

- [ ] **Step 6: Run smoke script against local/test DB**

Run:

```bash
pnpm --filter arcora-relayer smoke:crosschain
```

Expected: JSON output with `ok: true` and `crosschainPaymentsByStatus`.

- [ ] **Step 7: Commit Task 10**

```bash
git add ops/relayer/smoke-crosschain.ts ops/relayer/package.json ops/relayer/.env.example docs/runbooks/crosschain-v2-demo.md README.md
git commit -m "docs: add cross-chain v2 demo runbook"
```

## Task 11: Full Verification Gate

**Files:**
- Modify only if a previous task exposed a type/test failure.

- [ ] **Step 1: Run cross-chain core tests**

```bash
pnpm --filter @arcora/crosschain-core test
pnpm --filter @arcora/crosschain-core typecheck
```

Expected: PASS.

- [ ] **Step 2: Run app tests for touched areas**

```bash
pnpm --filter @arcora/app test \
  app/api/checkout/crosschain/prepare/route.test.ts \
  app/api/checkout/crosschain/submit/route.test.ts \
  'app/api/checkout/crosschain/status/[id]/route.test.ts' \
  components/checkout/CrossChainPayButton.test.tsx \
  lib/crosschain/receipt.test.ts \
  lib/db/schema.test.ts
pnpm --filter @arcora/app typecheck
```

Expected: PASS.

- [ ] **Step 3: Run relayer tests**

```bash
pnpm --filter arcora-relayer test \
  arc-settlement.test.ts \
  cctp.test.ts \
  crosschain-worker.test.ts \
  db.test.ts \
  gateway-allowlist.test.ts
pnpm --filter arcora-relayer typecheck
```

Expected: PASS.

- [ ] **Step 4: Run contract compatibility tests**

```bash
pnpm --filter @arcora/contracts test
```

Expected: PASS. No contract behavior changes are part of Q1.

- [ ] **Step 5: Run repo-level diff checks**

```bash
git diff --check
git status --short
```

Expected: no whitespace errors. `git status --short` should show only intentional files if the plan is still being implemented, or clean after commits.

- [ ] **Step 6: Final Q1 implementation commit**

If any verification-only fixes were needed:

```bash
git add .
git commit -m "test: verify cross-chain v2 code spine"
```

If no changes were needed, do not create an empty commit.

## Implementation Notes and Guardrails

- Do not remove the existing Arc-only Permit2 checkout path.
- Do not change `ArcFXGateway.sol` in this Q1 plan.
- Keep Base and Ethereum source routes enabled first; other source chains are config-only until smoke-tested.
- Keep chain IDs and labels in source, but load CCTP domains and contract/token
  addresses from `CROSSCHAIN_CHAIN_CONFIG_JSON`. `parseChainRegistryJson` must
  reject missing chains, malformed addresses, and zero addresses at startup.
- Store no private keys in repo files. Keep relayer key loading through Vault.
- Never settle a cross-chain payment unless bridge receipt or IRIS attestation has been observed and destination Arc USDC is available to the relayer.
- On payout shortfall, never call `settleInvoice`. Auto-refund only unswapped Arc USDC to the payer's same Arc address; preserve post-swap failures for operator recovery.
- Use `crosschain_payments.idempotency_key` to prevent repeated prepare calls from creating multiple bridge intents for one invoice/payer/source-chain tuple.
- Use `checkout_telemetry` for product metrics only; do not store raw wallet PII beyond addresses already required by payment state.

## Plan Self-Review

Spec coverage:

- Q1 code spine: Tasks 1-10.
- Base/Ethereum demo routes: Tasks 1, 3, 9, 10.
- Shared adapter architecture: Tasks 1, 7, 8.
- Bridge -> Arc receive -> Arc-side swap -> settle state machine: Tasks 7, 8.
- Quote/expiry/slippage/failure/idempotency behavior: Tasks 1, 3, 4, 8.
- Burn calldata binding and replay-safe destination receipt recovery: Tasks 4, 8.
- Pre-swap Arc USDC refund policy and post-swap operator recovery boundary: Tasks 8-10.
- Telemetry: Tasks 2, 3, 4, 10.
- Risk-based data model only: Task 2.
- Technical demo and smoke package: Task 10.

Placeholder scan:

- The plan contains no `TBD` or open placeholder sections.
- Live CCTP contract addresses are environment-provided and fail closed; test
  fixtures use deterministic non-zero addresses.

Type consistency:

- `CrosschainState` is exported from `@arcora/crosschain-core` and reused in `ops/relayer/crosschain-types.ts`.
- DB status names match `crosschain_payment_status`.
- `mintRecipient` and `bridgeAmountReceived` names match their SQL/Drizzle snake-case columns.
- API route names match UI calls.

## Implementation Divergences (as-built)

- The status route was security-trimmed (M12 parity): it returns only
  `{intentId, invoiceId, status, settleTxHash when paid, error stable code on
  failed states, updatedAt}` — NOT `burnTxHash`/`bridgeReceiveTxHash`/
  `arcSwapTxHash`/`sourceChainId` as Task 5's spec test showed. Do not re-add
  those fields.
- `prepare` allows safe re-prepare of `authorized` intents (in-place update;
  409 once past `authorized`); burn-tx hashes are unique per
  `(source_chain_id, burn_tx_hash)`.
- The UI persists a localStorage burn stash and resumes submission (no second
  burn); poll horizon ~30 min with a still-processing state.
- Attestation polls reset `attempts` and are bounded by
  `CROSSCHAIN_ATTESTATION_DEADLINE_MS` (default 2h).
- `run.ts` settle path zeroes the gateway allowance on settle failure;
  mid-flight tx-hash persists keep the row lease.
