# Plan 2a — Foundation (Gateway v0.3 + SDK + Backend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the foundation layer of the Arc FX Gateway product: a backwards-compatible Gateway v0.3.0 contract with delegate authorization, a pnpm-workspace Next.js app scaffolded on Vercel, the `@arc-fx/checkout` npm SDK + React adapter, server-side invoice/quote/auth API, and Vercel-cron-driven indexer + webhook dispatcher. End state: a curl-driven end-to-end flow (`POST /api/invoices` → on-chain `createInvoiceFor` → `Gateway.pay` from any wallet → cron picks up `InvoicePaid` → webhook delivered to `webhook.site`).

**Architecture:** pnpm monorepo with `packages/contracts` (existing Foundry project), `packages/app` (Next.js 15 App Router), `packages/sdk` (`@arc-fx/checkout`), `packages/sdk-react` (`@arc-fx/checkout-react`). API + cron live in `packages/app/app/api/**`. Postgres schema managed by drizzle-orm + drizzle-kit, migrations applied via Vercel deploy hook (or `pnpm db:push` in CI). Server hot wallet stored encrypted (AES-256-GCM) in `server_wallets` table. No frontend UI in this plan — that's Plan 2b.

**Tech Stack:** Solidity 0.8.26 (Foundry, OZ v5), TypeScript 5, Next.js 15 App Router, drizzle-orm, @vercel/postgres, viem 2.x, iron-session, bcryptjs, vitest, @vercel/postgres-test (or local docker-compose), tsup (SDK build), pnpm workspaces.

**Spec reference:** `docs/superpowers/specs/2026-04-25-plan-2-sdk-checkout-design.md`

---

## File Structure

```
arc-fx-gateway/
├── package.json                                 # root, already exists
├── pnpm-workspace.yaml                          # already exists, update for new packages
├── packages/
│   ├── contracts/                               # existing (Plan 1 + 1.5)
│   │   ├── src/ArcFXGateway.sol                 # MODIFY (Task 1)
│   │   ├── test/ArcFXGateway.t.sol              # MODIFY (Task 1)
│   │   ├── script/DeployAll.s.sol               # already exists
│   │   └── deployments/arc-testnet.json         # MODIFY (Task 2)
│   ├── sdk/                                     # NEW (Task 6)
│   │   ├── package.json                         # @arc-fx/checkout
│   │   ├── tsup.config.ts
│   │   ├── src/
│   │   │   ├── index.ts                         # public entry
│   │   │   ├── client.ts                        # createInvoice, openCheckout
│   │   │   ├── error.ts                         # ArcFXError class
│   │   │   └── types.ts
│   │   └── test/
│   │       ├── client.test.ts
│   │       └── error.test.ts
│   ├── sdk-react/                               # NEW (Task 7)
│   │   ├── package.json                         # @arc-fx/checkout-react
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── useCheckout.ts                   # hook
│   │   │   └── CheckoutButton.tsx               # component
│   │   └── test/useCheckout.test.tsx
│   └── app/                                     # NEW (Tasks 3-12)
│       ├── package.json
│       ├── next.config.ts
│       ├── tsconfig.json
│       ├── drizzle.config.ts
│       ├── docker-compose.yml                   # local Postgres
│       ├── vercel.json                          # cron schedule (Task 12)
│       ├── vitest.config.ts
│       ├── .env.example
│       ├── app/
│       │   └── api/
│       │       ├── invoices/
│       │       │   ├── route.ts                 # POST  (Task 10)
│       │       │   └── [id]/route.ts            # GET   (Task 11)
│       │       ├── quote/route.ts               # GET   (Task 11)
│       │       ├── auth/siwe/
│       │       │   ├── nonce/route.ts           # POST  (Task 8)
│       │       │   └── verify/route.ts          # POST  (Task 8)
│       │       └── cron/
│       │           ├── index-events/route.ts    # POST  (Task 12)
│       │           └── dispatch-webhooks/route.ts # POST (Task 12)
│       ├── lib/
│       │   ├── db/
│       │   │   ├── client.ts                    # drizzle pg client
│       │   │   ├── schema.ts                    # tables
│       │   │   └── migrations/                  # drizzle-kit output
│       │   ├── chain/
│       │   │   ├── client.ts                    # viem clients
│       │   │   ├── gateway-abi.ts
│       │   │   └── pool-abi.ts
│       │   ├── auth/
│       │   │   ├── apikey.ts                    # bcrypt + helpers (Task 9)
│       │   │   └── siwe.ts                      # SIWE verify (Task 8)
│       │   ├── crypto/
│       │   │   ├── webhook.ts                   # HMAC-SHA256 (Task 9)
│       │   │   └── secret.ts                    # AES-256-GCM (Task 9)
│       │   └── wallet/
│       │       └── server-wallet.ts             # encrypted hot wallet (Task 5)
│       └── test/
│           ├── helpers/
│           │   ├── db.ts                        # test DB fixture
│           │   └── chain.ts                     # forked anvil fixture
│           └── ...
└── docs/superpowers/
    └── plans/
        └── 2026-04-25-plan-2a-foundation.md     # this plan
```

---

## Task 1: Gateway v0.3.0 — `createInvoiceFor` + `authorizeDelegate`

**Files:**
- Modify: `/Users/huseyinarslan/arc-fx-gateway/packages/contracts/src/ArcFXGateway.sol`
- Modify: `/Users/huseyinarslan/arc-fx-gateway/packages/contracts/test/ArcFXGateway.t.sol`

- [ ] **Step 1: Add storage + events + errors + functions**

Append to `ArcFXGateway.sol` after the existing `withdrawFees` stub (replace each stub as you go in Plan 1, or just add the new code below if those are already implemented):

```solidity
// ── Delegate authorization ─────────────────────────────────────────
mapping(address merchant => mapping(address delegate => uint64 expiresAt))
    public delegateAuthorizations;

event DelegateAuthorized(address indexed merchant, address indexed delegate, uint64 expiresAt);
event DelegateRevoked(address indexed merchant, address indexed delegate);

error DelegateNotAuthorized();

function authorizeDelegate(address delegate, uint64 expiresAt) external {
    if (!merchants[msg.sender].registered) revert NotMerchant();
    delegateAuthorizations[msg.sender][delegate] = expiresAt;
    emit DelegateAuthorized(msg.sender, delegate, expiresAt);
}

function revokeDelegate(address delegate) external {
    delegateAuthorizations[msg.sender][delegate] = 0;
    emit DelegateRevoked(msg.sender, delegate);
}

function createInvoiceFor(
    address merchant,
    bytes32 id,
    address payIn,
    uint256 amountOut,
    uint64 expiresAt
) external {
    uint64 authExpiry = delegateAuthorizations[merchant][msg.sender];
    if (authExpiry < block.timestamp) revert DelegateNotAuthorized();

    Merchant memory m = merchants[merchant];
    if (!m.registered) revert NotMerchant();
    if (payIn == m.payoutToken) revert UnsupportedPair();
    if (payIn != address(USDC) && payIn != address(EURC)) revert UnsupportedPair();
    if (invoices[id].status != InvoiceStatus.None) revert InvoiceAlreadyExists(id);

    invoices[id] = Invoice({
        merchant:  merchant,
        payIn:     payIn,
        amountOut: amountOut,
        expiresAt: expiresAt,
        status:    InvoiceStatus.Created,
        paidBy:    address(0)
    });
    emit InvoiceCreated(id, merchant, payIn, amountOut, expiresAt);
}
```

- [ ] **Step 2: Build to verify compile**

Run: `cd /Users/huseyinarslan/arc-fx-gateway/packages/contracts && forge build`
Expected: Compiler run successful, no errors.

- [ ] **Step 3: Add 5 unit tests**

Append to `test/ArcFXGateway.t.sol`:

```solidity
function test_AuthorizeDelegate_Success() public {
    _registerMerchant();
    address delegate = makeAddr("delegate");
    vm.expectEmit(true, true, false, true, address(gw));
    emit ArcFXGateway.DelegateAuthorized(merchant, delegate, type(uint64).max);
    vm.prank(merchant);
    gw.authorizeDelegate(delegate, type(uint64).max);
    assertEq(gw.delegateAuthorizations(merchant, delegate), type(uint64).max);
}

function test_AuthorizeDelegate_RevertsForNonMerchant() public {
    address delegate = makeAddr("delegate");
    vm.prank(merchant); // not registered
    vm.expectRevert(ArcFXGateway.NotMerchant.selector);
    gw.authorizeDelegate(delegate, type(uint64).max);
}

function test_RevokeDelegate_Success() public {
    _registerMerchant();
    address delegate = makeAddr("delegate");
    vm.startPrank(merchant);
    gw.authorizeDelegate(delegate, type(uint64).max);
    gw.revokeDelegate(delegate);
    vm.stopPrank();
    assertEq(gw.delegateAuthorizations(merchant, delegate), 0);
}

function test_CreateInvoiceFor_Success() public {
    _registerMerchant();
    address delegate = makeAddr("delegate");
    vm.prank(merchant);
    gw.authorizeDelegate(delegate, type(uint64).max);

    bytes32 id = keccak256("auth-1");
    vm.prank(delegate);
    gw.createInvoiceFor(merchant, id, address(eurc), 49_990_000, uint64(block.timestamp + 30 minutes));

    (address m, address payIn, uint256 amt, , ArcFXGateway.InvoiceStatus s, ) = gw.invoices(id);
    assertEq(m, merchant);
    assertEq(payIn, address(eurc));
    assertEq(amt, 49_990_000);
    assertEq(uint8(s), uint8(ArcFXGateway.InvoiceStatus.Created));
}

function test_CreateInvoiceFor_RevertsIfNotAuthorized() public {
    _registerMerchant();
    address delegate = makeAddr("delegate");
    bytes32 id = keccak256("auth-2");
    vm.prank(delegate); // never authorized
    vm.expectRevert(ArcFXGateway.DelegateNotAuthorized.selector);
    gw.createInvoiceFor(merchant, id, address(eurc), 1, uint64(block.timestamp + 1 hours));
}

function test_CreateInvoiceFor_RevertsIfDelegateExpired() public {
    _registerMerchant();
    address delegate = makeAddr("delegate");
    vm.prank(merchant);
    gw.authorizeDelegate(delegate, uint64(block.timestamp + 1 minutes));

    vm.warp(block.timestamp + 5 minutes);
    bytes32 id = keccak256("auth-3");
    vm.prank(delegate);
    vm.expectRevert(ArcFXGateway.DelegateNotAuthorized.selector);
    gw.createInvoiceFor(merchant, id, address(eurc), 1, uint64(block.timestamp + 1 hours));
}
```

- [ ] **Step 4: Run new tests**

Run: `cd /Users/huseyinarslan/arc-fx-gateway/packages/contracts && forge test --match-test "test_(AuthorizeDelegate|RevokeDelegate|CreateInvoiceFor)" -vv`
Expected: 6 passed.

- [ ] **Step 5: Run full suite to confirm nothing broke**

Run: `forge test`
Expected: 63 total / 63 passed (was 57 + 6 new).

- [ ] **Step 6: Commit**

```bash
cd /Users/huseyinarslan/arc-fx-gateway
git add packages/contracts/src/ArcFXGateway.sol packages/contracts/test/ArcFXGateway.t.sol
git commit -m "feat(contracts): Gateway v0.3.0 — createInvoiceFor + delegate authorization"
```

---

## Task 2: Deploy Gateway v0.3.0 to Arc testnet

**Files:**
- Modify: `/Users/huseyinarslan/arc-fx-gateway/packages/contracts/deployments/arc-testnet.json`
- Modify: `/Users/huseyinarslan/arc-fx-gateway/packages/contracts/README.md`

- [ ] **Step 1: Deploy via forge create**

The existing OracleAMM (`0xC2020098aF328ac9CBD274267F424822C400dD66`) and MockChainlinkFeed (`0xF82F7676502935c4B86AAD36F405BfF7a3CA65D3`) are reused. Only Gateway is redeployed.

Run from `/Users/huseyinarslan/arc-fx-gateway/packages/contracts`:

```bash
source .env
forge create src/ArcFXGateway.sol:ArcFXGateway \
  --rpc-url $ARC_TESTNET_RPC \
  --private-key $DEPLOYER_PRIVATE_KEY \
  --broadcast \
  --constructor-args 0xC2020098aF328ac9CBD274267F424822C400dD66 0xF82F7676502935c4B86AAD36F405BfF7a3CA65D3 10 0xe8E5AAa3d8c705A07de02aADF98CE31F20A5754b
```
Expected output: `Deployed to: 0x...`. Capture this address as `GATEWAY_V03_ADDRESS`.

- [ ] **Step 2: Smoke test — register merchant, authorize delegate, createInvoiceFor**

Run from `packages/contracts`:
```bash
source .env
GW=<GATEWAY_V03_ADDRESS>
USDC=$USDC_ADDRESS
EURC=$EURC_ADDRESS
DEPLOYER=$DEPLOYER_ADDRESS

# 1. Register merchant (deployer is both merchant and delegate for smoke test)
cast send --rpc-url $ARC_TESTNET_RPC --private-key $DEPLOYER_PRIVATE_KEY $GW \
  "registerMerchant(address)" $USDC

# 2. Authorize self as delegate (with far-future expiry)
cast send --rpc-url $ARC_TESTNET_RPC --private-key $DEPLOYER_PRIVATE_KEY $GW \
  "authorizeDelegate(address,uint64)" $DEPLOYER 18446744073709551615

# 3. Create invoice via the new function
INV=0x0000000000000000000000000000000000000000000000000000000000000003
EXP=$(( $(date +%s) + 1800 ))
cast send --rpc-url $ARC_TESTNET_RPC --private-key $DEPLOYER_PRIVATE_KEY $GW \
  "createInvoiceFor(address,bytes32,address,uint256,uint64)" $DEPLOYER $INV $EURC 50000 $EXP

# 4. Check invoice exists
cast call --rpc-url $ARC_TESTNET_RPC $GW \
  "invoices(bytes32)(address,address,uint256,uint64,uint8,address)" $INV
```
Expected: all transactions return `status 1 (success)`. The final `cast call` shows the invoice with status `1` (Created).

- [ ] **Step 3: Update `deployments/arc-testnet.json`**

Move existing v0.2.0 to a `deprecated_v0.2.0` block (preserve old structure pattern). Add a `current` block for v0.3.0:

```json
"current": {
  "deployedAt": "2026-04-25",
  "label": "v0.3.0 — Gateway with delegate authorization (Plan 2a)",
  "contracts": {
    "ArcFXGateway": "<GATEWAY_V03_ADDRESS>",
    "OracleAMM": "0xC2020098aF328ac9CBD274267F424822C400dD66",
    "MockChainlinkFeed": "0xF82F7676502935c4B86AAD36F405BfF7a3CA65D3"
  },
  "config": { ... preserved from v0.2.0 ... },
  "smokeTest": {
    "createInvoiceFor": {
      "id": "0x000...0003",
      "merchant": "0xe8E5...754b",
      "delegate": "0xe8E5...754b",
      "txHash": "<from step 2 step 3>"
    }
  }
}
```

The existing `current` block (v0.2.0) becomes `deprecated_v0.2.0` (rename block; keep its content). Update the README's "Live deployment" table with the new Gateway address.

- [ ] **Step 4: Commit**

```bash
git -C /Users/huseyinarslan/arc-fx-gateway add packages/contracts/deployments/arc-testnet.json packages/contracts/README.md
git -C /Users/huseyinarslan/arc-fx-gateway commit -m "deploy(contracts): Gateway v0.3.0 live on Arc testnet"
```

---

## Task 3: Scaffold `packages/app` (Next.js 15) + tooling

**Files:**
- Modify: `/Users/huseyinarslan/arc-fx-gateway/pnpm-workspace.yaml`
- Create: `/Users/huseyinarslan/arc-fx-gateway/packages/app/package.json`
- Create: `/Users/huseyinarslan/arc-fx-gateway/packages/app/tsconfig.json`
- Create: `/Users/huseyinarslan/arc-fx-gateway/packages/app/next.config.ts`
- Create: `/Users/huseyinarslan/arc-fx-gateway/packages/app/vitest.config.ts`
- Create: `/Users/huseyinarslan/arc-fx-gateway/packages/app/.env.example`
- Create: `/Users/huseyinarslan/arc-fx-gateway/packages/app/docker-compose.yml`
- Create: `/Users/huseyinarslan/arc-fx-gateway/packages/app/app/layout.tsx` (minimal placeholder)
- Create: `/Users/huseyinarslan/arc-fx-gateway/packages/app/app/page.tsx` (minimal placeholder)

- [ ] **Step 1: Update `pnpm-workspace.yaml`**

Already covers `packages/*` so no change needed. Verify with `cat pnpm-workspace.yaml`.

- [ ] **Step 2: Create `packages/app/package.json`**

```json
{
  "name": "@arc-fx/app",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev -p 3000",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "db:generate": "drizzle-kit generate",
    "db:push": "drizzle-kit push",
    "db:up": "docker compose up -d postgres"
  },
  "dependencies": {
    "next": "^15.0.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "drizzle-orm": "^0.34.0",
    "@vercel/postgres": "^0.10.0",
    "viem": "^2.21.0",
    "iron-session": "^8.0.0",
    "siwe": "^3.0.0",
    "bcryptjs": "^2.4.3",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@types/bcryptjs": "^2.4.6",
    "drizzle-kit": "^0.27.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0",
    "@vitest/ui": "^2.1.0",
    "happy-dom": "^15.0.0",
    "supertest": "^7.0.0",
    "@types/supertest": "^6.0.0",
    "tsx": "^4.19.0"
  }
}
```

- [ ] **Step 3: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "baseUrl": ".",
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 4: Create `next.config.ts`**

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: { typedRoutes: true },
};

export default nextConfig;
```

- [ ] **Step 5: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts", "lib/**/*.test.ts", "app/**/*.test.ts"],
    setupFiles: ["./test/setup.ts"],
  },
  resolve: {
    alias: { "@": new URL("./", import.meta.url).pathname },
  },
});
```

Also create empty `test/setup.ts`:
```ts
// Reserved for global test setup (DB migrations, env loading, etc.).
import "dotenv/config";
```

- [ ] **Step 6: Create `.env.example`**

```
# Postgres
POSTGRES_URL=postgres://postgres:postgres@localhost:5432/arcfx
POSTGRES_URL_NON_POOLING=postgres://postgres:postgres@localhost:5432/arcfx

# Chain
ARC_TESTNET_RPC=https://rpc.testnet.arc.network
GATEWAY_ADDRESS=
ORACLE_ADDRESS=0xF82F7676502935c4B86AAD36F405BfF7a3CA65D3
POOL_ADDRESS=0xC2020098aF328ac9CBD274267F424822C400dD66
USDC_ADDRESS=0x3600000000000000000000000000000000000000
EURC_ADDRESS=0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a

# Server hot wallet
MASTER_KEY=                     # 32-byte base64; openssl rand -base64 32

# Auth
IRON_SESSION_PASSWORD=          # 32+ chars, openssl rand -base64 32
CRON_SECRET=                    # any random string, used in Authorization header for cron handlers

# Indexer
INDEXER_REORG_BUFFER_BLOCKS=5
```

- [ ] **Step 7: Create `docker-compose.yml`**

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: arcfx
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
volumes:
  pgdata:
```

- [ ] **Step 8: Create minimal `app/layout.tsx` and `app/page.tsx`**

`app/layout.tsx`:
```tsx
export const metadata = { title: "Arc FX Gateway" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
```

`app/page.tsx`:
```tsx
export default function Home() {
  return <main>Arc FX Gateway — backend live. UI deferred to Plan 2b.</main>;
}
```

- [ ] **Step 9: Install + verify build**

Run from repo root:
```bash
cd /Users/huseyinarslan/arc-fx-gateway
pnpm install
pnpm --filter @arc-fx/app run typecheck
pnpm --filter @arc-fx/app run build
```
Expected: typecheck clean, build succeeds.

- [ ] **Step 10: Commit**

```bash
git add packages/app .
git commit -m "feat(app): scaffold Next.js 15 app with Vercel + drizzle + vitest tooling"
```

---

## Task 4: Drizzle schema + migrations + test DB helper

**Files:**
- Create: `/Users/huseyinarslan/arc-fx-gateway/packages/app/lib/db/schema.ts`
- Create: `/Users/huseyinarslan/arc-fx-gateway/packages/app/lib/db/client.ts`
- Create: `/Users/huseyinarslan/arc-fx-gateway/packages/app/drizzle.config.ts`
- Create: `/Users/huseyinarslan/arc-fx-gateway/packages/app/test/helpers/db.ts`
- Create: `/Users/huseyinarslan/arc-fx-gateway/packages/app/lib/db/schema.test.ts`

- [ ] **Step 1: Write `lib/db/schema.ts`**

```ts
import {
  pgTable, text, uuid, timestamp, integer, numeric, jsonb, customType, boolean, pgEnum,
} from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer; default: false }>({
  dataType() { return "bytea"; },
});

export const invoiceStatus = pgEnum("invoice_status", ["created", "paid", "expired"]);

export const merchants = pgTable("merchants", {
  id: uuid("id").defaultRandom().primaryKey(),
  address: text("address").notNull().unique(),
  payoutToken: text("payout_token").notNull(),
  webhookUrl: text("webhook_url"),
  apiKeyHash: text("api_key_hash").notNull(),
  webhookSecretEnc: bytea("webhook_secret_enc").notNull(),
  webhookSecretIv: bytea("webhook_secret_iv").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const invoices = pgTable("invoices", {
  id: text("id").primaryKey(),                       // bytes32 hex
  merchantId: uuid("merchant_id").notNull().references(() => merchants.id),
  payInToken: text("pay_in_token").notNull(),
  amountOut: numeric("amount_out").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  status: invoiceStatus("status").notNull(),
  paidBy: text("paid_by"),
  paidTx: text("paid_tx"),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  metadata: jsonb("metadata"),
  successUrl: text("success_url").notNull(),
  cancelUrl: text("cancel_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const webhookAttempts = pgTable("webhook_attempts", {
  id: uuid("id").defaultRandom().primaryKey(),
  invoiceId: text("invoice_id").notNull().references(() => invoices.id),
  url: text("url").notNull(),
  payload: jsonb("payload").notNull(),
  attempts: integer("attempts").notNull().default(0),
  nextAttempt: timestamp("next_attempt", { withTimezone: true }).notNull(),
  succeededAt: timestamp("succeeded_at", { withTimezone: true }),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const indexerState = pgTable("indexer_state", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const serverWallets = pgTable("server_wallets", {
  id: uuid("id").defaultRandom().primaryKey(),
  address: text("address").notNull().unique(),
  encryptedPk: bytea("encrypted_pk").notNull(),
  pkIv: bytea("pk_iv").notNull(),
  balanceAlertBelow: numeric("balance_alert_below"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const siweNonces = pgTable("siwe_nonces", {
  nonce: text("nonce").primaryKey(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  used: boolean("used").notNull().default(false),
});
```

- [ ] **Step 2: Write `lib/db/client.ts`**

```ts
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

let _pool: Pool | undefined;
export function getPool(): Pool {
  if (!_pool) {
    _pool = new Pool({ connectionString: process.env.POSTGRES_URL });
  }
  return _pool;
}

export const db = drizzle(getPool(), { schema });
export { schema };
```

- [ ] **Step 3: Write `drizzle.config.ts`**

```ts
import "dotenv/config";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./lib/db/migrations",
  dialect: "postgresql",
  dbCredentials: { url: process.env.POSTGRES_URL! },
});
```

- [ ] **Step 4: Write `test/helpers/db.ts`** (per-test transaction rollback)

```ts
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import * as schema from "@/lib/db/schema";

let pool: Pool | undefined;
export function getTestPool() {
  if (!pool) pool = new Pool({ connectionString: process.env.POSTGRES_URL });
  return pool;
}

export async function withTx<T>(fn: (db: ReturnType<typeof drizzle>) => Promise<T>): Promise<T> {
  const client: PoolClient = await getTestPool().connect();
  try {
    await client.query("BEGIN");
    const txDb = drizzle(client, { schema });
    const result = await fn(txDb);
    await client.query("ROLLBACK");
    return result;
  } finally {
    client.release();
  }
}
```

- [ ] **Step 5: Write a smoke test for the schema**

`lib/db/schema.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { merchants, invoices } from "./schema";

describe("schema", () => {
  it("merchants table has expected columns", () => {
    expect(merchants.address).toBeDefined();
    expect(merchants.apiKeyHash).toBeDefined();
    expect(merchants.webhookSecretEnc).toBeDefined();
  });
  it("invoices status enum allows created/paid/expired", () => {
    expect(invoices.status).toBeDefined();
  });
});
```

- [ ] **Step 6: Push schema to local DB**

```bash
cd /Users/huseyinarslan/arc-fx-gateway/packages/app
docker compose up -d postgres
sleep 3
cp .env.example .env
pnpm db:push
```
Expected: drizzle reports tables created.

- [ ] **Step 7: Run schema test**

Run: `pnpm --filter @arc-fx/app test`
Expected: 2 passed.

- [ ] **Step 8: Commit**

```bash
git -C /Users/huseyinarslan/arc-fx-gateway add packages/app/lib/db packages/app/drizzle.config.ts packages/app/test/helpers/db.ts
git -C /Users/huseyinarslan/arc-fx-gateway commit -m "feat(app): drizzle schema + client + test DB helper"
```

---

## Task 5: Server hot wallet — encrypt/decrypt keystore

**Files:**
- Create: `/Users/huseyinarslan/arc-fx-gateway/packages/app/lib/wallet/server-wallet.ts`
- Create: `/Users/huseyinarslan/arc-fx-gateway/packages/app/lib/wallet/server-wallet.test.ts`
- Create: `/Users/huseyinarslan/arc-fx-gateway/packages/app/lib/crypto/secret.ts`
- Create: `/Users/huseyinarslan/arc-fx-gateway/packages/app/lib/crypto/secret.test.ts`

- [ ] **Step 1: Write `lib/crypto/secret.ts`** (AES-256-GCM helpers)

```ts
import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;

function getKey(): Buffer {
  const k = process.env.MASTER_KEY;
  if (!k) throw new Error("MASTER_KEY missing");
  const buf = Buffer.from(k, "base64");
  if (buf.length !== 32) throw new Error("MASTER_KEY must be 32 bytes (base64)");
  return buf;
}

/** Encrypts UTF-8 plaintext. Returns { iv, ciphertext } where ciphertext = data || tag. */
export function encrypt(plaintext: string): { iv: Buffer; ciphertext: Buffer } {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, getKey(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { iv, ciphertext: Buffer.concat([enc, tag]) };
}

export function decrypt(iv: Buffer, ciphertext: Buffer): string {
  const tag = ciphertext.subarray(ciphertext.length - TAG_LEN);
  const data = ciphertext.subarray(0, ciphertext.length - TAG_LEN);
  const decipher = createDecipheriv(ALGO, getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
```

- [ ] **Step 2: Write `lib/crypto/secret.test.ts`**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { encrypt, decrypt } from "./secret";
import { randomBytes } from "node:crypto";

describe("AES-256-GCM secret helper", () => {
  beforeEach(() => {
    process.env.MASTER_KEY = randomBytes(32).toString("base64");
  });

  it("round-trips a string", () => {
    const { iv, ciphertext } = encrypt("hello world");
    expect(decrypt(iv, ciphertext)).toBe("hello world");
  });

  it("different IVs produce different ciphertexts", () => {
    const a = encrypt("same plaintext");
    const b = encrypt("same plaintext");
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
  });

  it("rejects tampered ciphertext", () => {
    const { iv, ciphertext } = encrypt("secret");
    ciphertext[0] ^= 0xff;
    expect(() => decrypt(iv, ciphertext)).toThrow();
  });

  it("rejects wrong IV", () => {
    const { ciphertext } = encrypt("secret");
    expect(() => decrypt(randomBytes(12), ciphertext)).toThrow();
  });

  it("throws if MASTER_KEY is missing", () => {
    delete process.env.MASTER_KEY;
    expect(() => encrypt("x")).toThrow(/MASTER_KEY/);
  });
});
```

- [ ] **Step 3: Run tests**

Run: `cd /Users/huseyinarslan/arc-fx-gateway/packages/app && pnpm test lib/crypto`
Expected: 5 passed.

- [ ] **Step 4: Write `lib/wallet/server-wallet.ts`**

```ts
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Account, Hex } from "viem";
import { db } from "@/lib/db/client";
import { serverWallets } from "@/lib/db/schema";
import { encrypt, decrypt } from "@/lib/crypto/secret";
import { eq } from "drizzle-orm";

export type ServerWalletRow = typeof serverWallets.$inferSelect;

/** Generates a fresh hot wallet, encrypts the key, and persists. Returns the new account. */
export async function provisionServerWallet(): Promise<Account> {
  const pk = generatePrivateKey();
  const account = privateKeyToAccount(pk);
  const { iv, ciphertext } = encrypt(pk);
  await db.insert(serverWallets).values({
    address: account.address,
    encryptedPk: ciphertext,
    pkIv: iv,
  });
  return account;
}

/** Loads the most recent server wallet from DB and returns a viem Account. */
export async function loadServerWallet(): Promise<Account> {
  const rows = await db.select().from(serverWallets).limit(1);
  if (rows.length === 0) throw new Error("no server wallet provisioned");
  const row = rows[0]!;
  const pk = decrypt(row.pkIv, row.encryptedPk) as Hex;
  return privateKeyToAccount(pk);
}
```

- [ ] **Step 5: Write `lib/wallet/server-wallet.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { randomBytes } from "node:crypto";
import { provisionServerWallet, loadServerWallet } from "./server-wallet";
import { db } from "@/lib/db/client";
import { serverWallets } from "@/lib/db/schema";

describe("server-wallet", () => {
  beforeAll(() => {
    process.env.MASTER_KEY = randomBytes(32).toString("base64");
  });
  afterEach(async () => {
    await db.delete(serverWallets);
  });

  it("provisions a new wallet and stores encrypted key", async () => {
    const account = await provisionServerWallet();
    expect(account.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    const rows = await db.select().from(serverWallets);
    expect(rows.length).toBe(1);
    expect(rows[0]!.address).toBe(account.address);
  });

  it("round-trips: provision then load returns same address", async () => {
    const a = await provisionServerWallet();
    const b = await loadServerWallet();
    expect(b.address).toBe(a.address);
  });

  it("loadServerWallet throws when none provisioned", async () => {
    await expect(loadServerWallet()).rejects.toThrow(/no server wallet/);
  });
});
```

- [ ] **Step 6: Run tests**

Run: `pnpm --filter @arc-fx/app test lib/wallet`
Expected: 3 passed.

- [ ] **Step 7: Commit**

```bash
git -C /Users/huseyinarslan/arc-fx-gateway add packages/app/lib/crypto packages/app/lib/wallet
git -C /Users/huseyinarslan/arc-fx-gateway commit -m "feat(app): server hot wallet with AES-256-GCM keystore"
```

---

## Task 6: `@arc-fx/checkout` SDK

**Files:**
- Create: `/Users/huseyinarslan/arc-fx-gateway/packages/sdk/package.json`
- Create: `/Users/huseyinarslan/arc-fx-gateway/packages/sdk/tsup.config.ts`
- Create: `/Users/huseyinarslan/arc-fx-gateway/packages/sdk/tsconfig.json`
- Create: `/Users/huseyinarslan/arc-fx-gateway/packages/sdk/src/index.ts`
- Create: `/Users/huseyinarslan/arc-fx-gateway/packages/sdk/src/client.ts`
- Create: `/Users/huseyinarslan/arc-fx-gateway/packages/sdk/src/error.ts`
- Create: `/Users/huseyinarslan/arc-fx-gateway/packages/sdk/src/types.ts`
- Create: `/Users/huseyinarslan/arc-fx-gateway/packages/sdk/test/client.test.ts`
- Create: `/Users/huseyinarslan/arc-fx-gateway/packages/sdk/test/error.test.ts`

- [ ] **Step 1: `package.json`**

```json
{
  "name": "@arc-fx/checkout",
  "version": "0.1.0",
  "description": "Stripe-style checkout SDK for the Arc FX Gateway",
  "license": "MIT",
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/index.cjs"
    }
  },
  "files": ["dist"],
  "sideEffects": false,
  "scripts": {
    "build": "tsup",
    "dev": "tsup --watch",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "devDependencies": {
    "tsup": "^8.3.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "esnext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "outDir": "dist"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: `tsup.config.ts`**

```ts
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  minify: true,
});
```

- [ ] **Step 4: `src/types.ts`**

```ts
export type Environment = "testnet" | "mainnet";
export type PayInToken = "USDC" | "EURC";

export interface Invoice {
  invoiceId: string;
  url: string;
}

export interface CreateInvoiceParams {
  amountUsdc: number;
  payInToken: PayInToken;
  successUrl: string;
  cancelUrl?: string;
  metadata?: Record<string, string>;
}

export interface InitOptions {
  apiKey: string;
  environment?: Environment;
  baseUrl?: string;          // overrides default per-environment URL
}
```

- [ ] **Step 5: `src/error.ts`** (write tests first — TDD)

`test/error.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { ArcFXError } from "../src/error";

describe("ArcFXError", () => {
  it("has a discriminated code", () => {
    const e = new ArcFXError("INVALID_API_KEY", "bad key");
    expect(e.code).toBe("INVALID_API_KEY");
    expect(e.message).toBe("bad key");
    expect(e.name).toBe("ArcFXError");
  });
  it("preserves cause", () => {
    const cause = new Error("network down");
    const e = new ArcFXError("NETWORK", "fetch failed", { cause });
    expect(e.cause).toBe(cause);
  });
  it("retains optional context", () => {
    const e = new ArcFXError("SERVER_ERROR", "oops", { retryAfter: 30 });
    expect(e.retryAfter).toBe(30);
  });
});
```

Run: `pnpm --filter @arc-fx/checkout test` — expect FAIL (no implementation).

`src/error.ts`:
```ts
export type ArcFXErrorCode =
  | "INVALID_API_KEY"
  | "NETWORK"
  | "SERVER_ERROR"
  | "INVALID_URL"
  | "TIMEOUT"
  | "UNKNOWN";

export interface ArcFXErrorOptions {
  cause?: unknown;
  retryAfter?: number;
}

export class ArcFXError extends Error {
  readonly code: ArcFXErrorCode;
  readonly retryAfter?: number;

  constructor(code: ArcFXErrorCode, message: string, opts: ArcFXErrorOptions = {}) {
    super(message, { cause: opts.cause });
    this.name = "ArcFXError";
    this.code = code;
    this.retryAfter = opts.retryAfter;
  }
}
```

Run again — expect 3 passed.

- [ ] **Step 6: `src/client.ts`** (write tests first)

`test/client.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ArcFX } from "../src";
import { ArcFXError } from "../src/error";

const ORIG_FETCH = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = vi.fn();
  ArcFX.init({ apiKey: "ak_test_xxx", environment: "testnet" });
});

describe("ArcFX.createInvoice", () => {
  it("posts to /api/invoices and returns the invoice", async () => {
    (globalThis.fetch as any).mockResolvedValue(
      new Response(JSON.stringify({ invoiceId: "0xabc", url: "https://x/i/0xabc" }), {
        status: 201,
        headers: { "content-type": "application/json" },
      })
    );
    const inv = await ArcFX.createInvoice({
      amountUsdc: 49.99,
      payInToken: "EURC",
      successUrl: "https://merchant.example/ok",
    });
    expect(inv).toEqual({ invoiceId: "0xabc", url: "https://x/i/0xabc" });
    const call = (globalThis.fetch as any).mock.calls[0];
    expect(call[1].method).toBe("POST");
    expect(call[1].headers["X-Arc-Api-Key"]).toBe("ak_test_xxx");
  });

  it("throws INVALID_API_KEY on 401", async () => {
    (globalThis.fetch as any).mockResolvedValue(
      new Response(JSON.stringify({ error: "invalid_api_key" }), { status: 401 })
    );
    await expect(
      ArcFX.createInvoice({ amountUsdc: 1, payInToken: "EURC", successUrl: "https://x" })
    ).rejects.toMatchObject({ code: "INVALID_API_KEY" });
  });

  it("throws SERVER_ERROR on 5xx with Retry-After", async () => {
    (globalThis.fetch as any).mockResolvedValue(
      new Response("err", { status: 503, headers: { "retry-after": "30" } })
    );
    try {
      await ArcFX.createInvoice({ amountUsdc: 1, payInToken: "EURC", successUrl: "https://x" });
      expect.fail("expected throw");
    } catch (e: any) {
      expect(e).toBeInstanceOf(ArcFXError);
      expect(e.code).toBe("SERVER_ERROR");
      expect(e.retryAfter).toBe(30);
    }
  });

  it("throws INVALID_URL synchronously for non-http successUrl", async () => {
    await expect(
      ArcFX.createInvoice({ amountUsdc: 1, payInToken: "EURC", successUrl: "javascript:alert(1)" as any })
    ).rejects.toMatchObject({ code: "INVALID_URL" });
  });
});

describe("ArcFX.openCheckout", () => {
  it("sets window.location.href to invoice.url", () => {
    const setHref = vi.fn();
    Object.defineProperty(globalThis, "window", {
      value: { location: { set href(url: string) { setHref(url); } } },
      configurable: true,
    });
    ArcFX.openCheckout({ url: "https://checkout.arc-fx.xyz/i/0xabc" });
    expect(setHref).toHaveBeenCalledWith("https://checkout.arc-fx.xyz/i/0xabc");
  });
});

afterAll(() => { globalThis.fetch = ORIG_FETCH; });
```

`src/client.ts`:
```ts
import { ArcFXError } from "./error";
import type { CreateInvoiceParams, Invoice, InitOptions, Environment } from "./types";

const ENV_BASE_URL: Record<Environment, string> = {
  testnet: "https://checkout-staging.arc-fx.xyz",
  mainnet: "https://checkout.arc-fx.xyz",
};

let _opts: InitOptions | undefined;

function init(opts: InitOptions): void { _opts = opts; }
function getOpts(): InitOptions {
  if (!_opts) throw new ArcFXError("UNKNOWN", "ArcFX.init was not called");
  return _opts;
}

function baseUrl(): string {
  const o = getOpts();
  return o.baseUrl ?? ENV_BASE_URL[o.environment ?? "testnet"];
}

function isHttp(u: string): boolean {
  try {
    const url = new URL(u);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch { return false; }
}

async function createInvoice(params: CreateInvoiceParams): Promise<Invoice> {
  if (!isHttp(params.successUrl)) {
    throw new ArcFXError("INVALID_URL", `successUrl must be http(s): got ${params.successUrl}`);
  }
  if (params.cancelUrl && !isHttp(params.cancelUrl)) {
    throw new ArcFXError("INVALID_URL", `cancelUrl must be http(s): got ${params.cancelUrl}`);
  }

  const o = getOpts();
  let res: Response;
  try {
    res = await fetch(`${baseUrl()}/api/invoices`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Arc-Api-Key": o.apiKey,
      },
      body: JSON.stringify(params),
    });
  } catch (e) {
    throw new ArcFXError("NETWORK", "request failed", { cause: e });
  }

  if (res.status === 401) throw new ArcFXError("INVALID_API_KEY", "API key rejected");
  if (res.status >= 500) {
    const ra = res.headers.get("retry-after");
    throw new ArcFXError("SERVER_ERROR", `server returned ${res.status}`, {
      retryAfter: ra ? Number(ra) : undefined,
    });
  }
  if (!res.ok) {
    throw new ArcFXError("UNKNOWN", `unexpected ${res.status}`);
  }

  const json = await res.json() as { invoiceId: string; url: string };
  return { invoiceId: json.invoiceId, url: json.url };
}

function openCheckout(invoice: { url: string }): void {
  if (typeof window === "undefined") {
    throw new ArcFXError("UNKNOWN", "openCheckout requires a browser environment");
  }
  window.location.href = invoice.url;
}

export const ArcFX = { init, createInvoice, openCheckout };
```

`src/index.ts`:
```ts
export { ArcFX } from "./client";
export { ArcFXError, type ArcFXErrorCode } from "./error";
export type * from "./types";
```

- [ ] **Step 7: Run tests**

Run: `pnpm --filter @arc-fx/checkout test`
Expected: 8 passed (3 error + 5 client).

- [ ] **Step 8: Build**

Run: `pnpm --filter @arc-fx/checkout build`
Expected: `dist/index.{js,cjs,d.ts}` produced. Bundle size <5 KB gzipped (verify with `du -k dist/index.js | head -1`).

- [ ] **Step 9: Commit**

```bash
git -C /Users/huseyinarslan/arc-fx-gateway add packages/sdk
git -C /Users/huseyinarslan/arc-fx-gateway commit -m "feat(sdk): @arc-fx/checkout — init, createInvoice, openCheckout, ArcFXError"
```

---

## Task 7: `@arc-fx/checkout-react` adapter

**Files:**
- Create: `/Users/huseyinarslan/arc-fx-gateway/packages/sdk-react/package.json`
- Create: `/Users/huseyinarslan/arc-fx-gateway/packages/sdk-react/tsconfig.json`
- Create: `/Users/huseyinarslan/arc-fx-gateway/packages/sdk-react/tsup.config.ts`
- Create: `/Users/huseyinarslan/arc-fx-gateway/packages/sdk-react/src/index.ts`
- Create: `/Users/huseyinarslan/arc-fx-gateway/packages/sdk-react/src/useCheckout.ts`
- Create: `/Users/huseyinarslan/arc-fx-gateway/packages/sdk-react/src/CheckoutButton.tsx`
- Create: `/Users/huseyinarslan/arc-fx-gateway/packages/sdk-react/test/useCheckout.test.tsx`

- [ ] **Step 1: `package.json`**

```json
{
  "name": "@arc-fx/checkout-react",
  "version": "0.1.0",
  "license": "MIT",
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "files": ["dist"],
  "scripts": {
    "build": "tsup",
    "test": "vitest run"
  },
  "peerDependencies": {
    "react": "^18.0.0 || ^19.0.0",
    "@arc-fx/checkout": "workspace:*"
  },
  "devDependencies": {
    "@arc-fx/checkout": "workspace:*",
    "@testing-library/react": "^16.0.0",
    "happy-dom": "^15.0.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "tsup": "^8.3.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: `tsconfig.json`** — same as SDK but with `"jsx": "react-jsx"` added.

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "esnext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "outDir": "dist",
    "jsx": "react-jsx"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: `tsup.config.ts`** — same as SDK.

- [ ] **Step 4: Write tests first**

`test/useCheckout.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useCheckout } from "../src/useCheckout";
import { ArcFX } from "@arc-fx/checkout";

vi.mock("@arc-fx/checkout", () => ({
  ArcFX: {
    init: vi.fn(),
    createInvoice: vi.fn(),
    openCheckout: vi.fn(),
  },
  ArcFXError: class extends Error { code = "TEST"; },
}));

beforeEach(() => { vi.clearAllMocks(); });

describe("useCheckout", () => {
  it("initializes ArcFX with the provided apiKey", () => {
    renderHook(() => useCheckout({ apiKey: "ak_x", environment: "testnet" }));
    expect(ArcFX.init).toHaveBeenCalledWith({ apiKey: "ak_x", environment: "testnet" });
  });

  it("checkout() creates invoice then opens checkout", async () => {
    (ArcFX.createInvoice as any).mockResolvedValue({ invoiceId: "0x1", url: "https://x/i/1" });
    const { result } = renderHook(() => useCheckout({ apiKey: "ak_x" }));
    await act(async () => {
      await result.current.checkout({ amountUsdc: 1, payInToken: "EURC", successUrl: "https://m" });
    });
    expect(ArcFX.openCheckout).toHaveBeenCalledWith({ invoiceId: "0x1", url: "https://x/i/1" });
  });

  it("exposes loading + error state", async () => {
    (ArcFX.createInvoice as any).mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useCheckout({ apiKey: "ak_x" }));
    await act(async () => {
      try {
        await result.current.checkout({ amountUsdc: 1, payInToken: "EURC", successUrl: "https://m" });
      } catch {}
    });
    expect(result.current.error).toBeTruthy();
  });
});
```

`vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { environment: "happy-dom" },
});
```

- [ ] **Step 5: Implement**

`src/useCheckout.ts`:
```ts
import { useCallback, useState } from "react";
import { ArcFX, type CreateInvoiceParams, type Invoice, type InitOptions } from "@arc-fx/checkout";

export interface UseCheckoutResult {
  checkout: (params: CreateInvoiceParams) => Promise<Invoice>;
  loading: boolean;
  error: Error | null;
}

export function useCheckout(opts: InitOptions): UseCheckoutResult {
  ArcFX.init(opts);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const checkout = useCallback(async (params: CreateInvoiceParams): Promise<Invoice> => {
    setLoading(true);
    setError(null);
    try {
      const inv = await ArcFX.createInvoice(params);
      ArcFX.openCheckout(inv);
      return inv;
    } catch (e) {
      setError(e as Error);
      throw e;
    } finally {
      setLoading(false);
    }
  }, [opts.apiKey]);

  return { checkout, loading, error };
}
```

`src/CheckoutButton.tsx`:
```tsx
import { useCheckout } from "./useCheckout";
import type { CreateInvoiceParams, InitOptions } from "@arc-fx/checkout";

export interface CheckoutButtonProps extends InitOptions {
  invoice: CreateInvoiceParams;
  children?: React.ReactNode;
  className?: string;
}

export function CheckoutButton({ apiKey, environment, baseUrl, invoice, children, className }: CheckoutButtonProps) {
  const { checkout, loading } = useCheckout({ apiKey, environment, baseUrl });
  return (
    <button onClick={() => checkout(invoice)} disabled={loading} className={className}>
      {children ?? (loading ? "Loading..." : "Pay")}
    </button>
  );
}
```

`src/index.ts`:
```ts
export { useCheckout, type UseCheckoutResult } from "./useCheckout";
export { CheckoutButton, type CheckoutButtonProps } from "./CheckoutButton";
```

- [ ] **Step 6: Run tests + build**

```bash
pnpm --filter @arc-fx/checkout-react test
pnpm --filter @arc-fx/checkout-react build
```
Expected: 3 tests pass, build succeeds.

- [ ] **Step 7: Commit**

```bash
git -C /Users/huseyinarslan/arc-fx-gateway add packages/sdk-react
git -C /Users/huseyinarslan/arc-fx-gateway commit -m "feat(sdk-react): @arc-fx/checkout-react with useCheckout + CheckoutButton"
```

---

## Task 8: SIWE auth — nonce + verify

**Files:**
- Create: `/Users/huseyinarslan/arc-fx-gateway/packages/app/lib/auth/siwe.ts`
- Create: `/Users/huseyinarslan/arc-fx-gateway/packages/app/lib/auth/siwe.test.ts`
- Create: `/Users/huseyinarslan/arc-fx-gateway/packages/app/lib/auth/session.ts`
- Create: `/Users/huseyinarslan/arc-fx-gateway/packages/app/app/api/auth/siwe/nonce/route.ts`
- Create: `/Users/huseyinarslan/arc-fx-gateway/packages/app/app/api/auth/siwe/verify/route.ts`

- [ ] **Step 1: `lib/auth/session.ts`** (iron-session config)

```ts
import { getIronSession, type SessionOptions } from "iron-session";
import { cookies } from "next/headers";

export interface SessionData {
  merchantAddress?: string;
}

export const sessionOptions: SessionOptions = {
  password: process.env.IRON_SESSION_PASSWORD!,
  cookieName: "arcfx_session",
  cookieOptions: {
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    httpOnly: true,
  },
};

export async function getSession() {
  return getIronSession<SessionData>(await cookies(), sessionOptions);
}
```

- [ ] **Step 2: `lib/auth/siwe.ts` (TDD)**

`lib/auth/siwe.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { generateNonce, verifySiweMessage } from "./siwe";
import { db } from "@/lib/db/client";
import { siweNonces } from "@/lib/db/schema";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { SiweMessage } from "siwe";

beforeEach(async () => { await db.delete(siweNonces); });
afterEach(async () => { await db.delete(siweNonces); });

describe("siwe helpers", () => {
  it("generates a nonce, stores it, returns it", async () => {
    const nonce = await generateNonce();
    expect(nonce).toMatch(/^[A-Za-z0-9]{17,32}$/);
    const rows = await db.select().from(siweNonces);
    expect(rows.length).toBe(1);
    expect(rows[0]!.nonce).toBe(nonce);
    expect(rows[0]!.used).toBe(false);
  });

  it("verifies a valid SIWE signature", async () => {
    const pk = generatePrivateKey();
    const acct = privateKeyToAccount(pk);
    const nonce = await generateNonce();
    const msg = new SiweMessage({
      domain: "localhost",
      address: acct.address,
      statement: "Sign in to Arc FX",
      uri: "http://localhost:3000",
      version: "1",
      chainId: 5042002,
      nonce,
    });
    const message = msg.prepareMessage();
    const signature = await acct.signMessage({ message });
    const { address } = await verifySiweMessage({ message, signature });
    expect(address.toLowerCase()).toBe(acct.address.toLowerCase());
  });

  it("rejects reused nonce", async () => {
    const pk = generatePrivateKey();
    const acct = privateKeyToAccount(pk);
    const nonce = await generateNonce();
    const msg = new SiweMessage({
      domain: "localhost", address: acct.address, statement: "Sign in",
      uri: "http://localhost:3000", version: "1", chainId: 5042002, nonce,
    });
    const message = msg.prepareMessage();
    const signature = await acct.signMessage({ message });
    await verifySiweMessage({ message, signature });
    await expect(verifySiweMessage({ message, signature })).rejects.toThrow(/nonce/i);
  });
});
```

`lib/auth/siwe.ts`:
```ts
import { generateNonce as siweGenerateNonce, SiweMessage } from "siwe";
import { db } from "@/lib/db/client";
import { siweNonces } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

const NONCE_TTL_MINUTES = 10;

export async function generateNonce(): Promise<string> {
  const nonce = siweGenerateNonce();
  const expiresAt = new Date(Date.now() + NONCE_TTL_MINUTES * 60_000);
  await db.insert(siweNonces).values({ nonce, expiresAt, used: false });
  return nonce;
}

export interface VerifyResult { address: string; chainId: number; }

export async function verifySiweMessage(args: { message: string; signature: string }): Promise<VerifyResult> {
  const siwe = new SiweMessage(args.message);
  const verification = await siwe.verify({ signature: args.signature });
  if (!verification.success) throw new Error("siwe signature invalid");

  const rows = await db.select().from(siweNonces).where(eq(siweNonces.nonce, siwe.nonce));
  if (rows.length === 0) throw new Error("siwe nonce unknown");
  const row = rows[0]!;
  if (row.used) throw new Error("siwe nonce already used");
  if (row.expiresAt.getTime() < Date.now()) throw new Error("siwe nonce expired");

  await db.update(siweNonces).set({ used: true }).where(eq(siweNonces.nonce, siwe.nonce));
  return { address: siwe.address, chainId: siwe.chainId };
}
```

- [ ] **Step 3: Run tests** — `pnpm --filter @arc-fx/app test lib/auth` — expect 3 passed.

- [ ] **Step 4: API routes**

`app/api/auth/siwe/nonce/route.ts`:
```ts
import { NextResponse } from "next/server";
import { generateNonce } from "@/lib/auth/siwe";

export async function POST() {
  const nonce = await generateNonce();
  return NextResponse.json({ nonce });
}
```

`app/api/auth/siwe/verify/route.ts`:
```ts
import { NextRequest, NextResponse } from "next/server";
import { verifySiweMessage } from "@/lib/auth/siwe";
import { getSession } from "@/lib/auth/session";
import { z } from "zod";

const Body = z.object({ message: z.string(), signature: z.string() });

export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "bad_body" }, { status: 400 });
  try {
    const { address } = await verifySiweMessage(parsed.data);
    const session = await getSession();
    session.merchantAddress = address;
    await session.save();
    return NextResponse.json({ address });
  } catch (e: any) {
    return NextResponse.json({ error: "siwe_verify_failed", detail: e?.message }, { status: 401 });
  }
}
```

- [ ] **Step 5: Commit**

```bash
git -C /Users/huseyinarslan/arc-fx-gateway add packages/app/lib/auth packages/app/app/api/auth
git -C /Users/huseyinarslan/arc-fx-gateway commit -m "feat(app): SIWE auth — nonce, verify, session"
```

---

## Task 9: API key auth + crypto helpers (HMAC, AES already done)

**Files:**
- Create: `/Users/huseyinarslan/arc-fx-gateway/packages/app/lib/auth/apikey.ts`
- Create: `/Users/huseyinarslan/arc-fx-gateway/packages/app/lib/auth/apikey.test.ts`
- Create: `/Users/huseyinarslan/arc-fx-gateway/packages/app/lib/crypto/webhook.ts`
- Create: `/Users/huseyinarslan/arc-fx-gateway/packages/app/lib/crypto/webhook.test.ts`

- [ ] **Step 1: `lib/auth/apikey.ts` (TDD)**

`lib/auth/apikey.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import { generateApiKey, hashApiKey, verifyApiKey, lookupMerchantByApiKey } from "./apikey";
import { db } from "@/lib/db/client";
import { merchants } from "@/lib/db/schema";
import { randomBytes } from "node:crypto";

beforeEach(async () => {
  await db.delete(merchants);
  process.env.MASTER_KEY = randomBytes(32).toString("base64");
});

describe("api key", () => {
  it("generateApiKey returns prefixed 64-char string", () => {
    const k = generateApiKey();
    expect(k).toMatch(/^ak_live_[A-Za-z0-9]{56}$/);
  });

  it("hashApiKey is deterministic-by-input but unique-by-call (bcrypt salt)", async () => {
    const a = await hashApiKey("ak_live_xxx");
    const b = await hashApiKey("ak_live_xxx");
    expect(a).not.toBe(b);
    expect(await verifyApiKey("ak_live_xxx", a)).toBe(true);
    expect(await verifyApiKey("ak_live_xxx", b)).toBe(true);
    expect(await verifyApiKey("ak_live_yyy", a)).toBe(false);
  });

  it("lookupMerchantByApiKey returns the merchant when key matches", async () => {
    const k = generateApiKey();
    const hash = await hashApiKey(k);
    await db.insert(merchants).values({
      address: "0x" + "a".repeat(40),
      payoutToken: "0x" + "b".repeat(40),
      apiKeyHash: hash,
      webhookSecretEnc: Buffer.alloc(48),
      webhookSecretIv: Buffer.alloc(12),
    });
    const m = await lookupMerchantByApiKey(k);
    expect(m).not.toBeNull();
    expect(m!.address).toBe("0x" + "a".repeat(40));
  });

  it("lookupMerchantByApiKey returns null on bad key", async () => {
    expect(await lookupMerchantByApiKey("ak_live_nonexistent")).toBeNull();
  });
});
```

`lib/auth/apikey.ts`:
```ts
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { db } from "@/lib/db/client";
import { merchants } from "@/lib/db/schema";

const PREFIX = "ak_live_";
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

export function generateApiKey(): string {
  const bytes = randomBytes(56);
  let out = "";
  for (let i = 0; i < 56; i++) out += ALPHABET[bytes[i]! % ALPHABET.length];
  return PREFIX + out;
}

export async function hashApiKey(key: string): Promise<string> {
  return bcrypt.hash(key, 10);
}

export async function verifyApiKey(key: string, hash: string): Promise<boolean> {
  return bcrypt.compare(key, hash);
}

/** Returns the matching merchant or null. O(N merchants) — acceptable for demo scale. */
export async function lookupMerchantByApiKey(key: string) {
  if (!key.startsWith(PREFIX)) return null;
  const all = await db.select().from(merchants);
  for (const m of all) {
    if (await verifyApiKey(key, m.apiKeyHash)) return m;
  }
  return null;
}
```

- [ ] **Step 2: `lib/crypto/webhook.ts` (TDD)**

`lib/crypto/webhook.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { signWebhook, verifyWebhookSignature } from "./webhook";

describe("webhook signing", () => {
  it("HMAC-SHA256 produces hex prefixed sha256=", () => {
    const sig = signWebhook("hello", "secret");
    expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/);
  });

  it("verify returns true for valid signature", () => {
    const sig = signWebhook("payload", "key");
    expect(verifyWebhookSignature("payload", sig, "key")).toBe(true);
  });

  it("verify returns false for tampered signature", () => {
    expect(verifyWebhookSignature("payload", "sha256=" + "0".repeat(64), "key")).toBe(false);
  });

  it("verify returns false for tampered body", () => {
    const sig = signWebhook("payload", "key");
    expect(verifyWebhookSignature("payload2", sig, "key")).toBe(false);
  });
});
```

`lib/crypto/webhook.ts`:
```ts
import { createHmac, timingSafeEqual } from "node:crypto";

export function signWebhook(body: string, secret: string): string {
  const mac = createHmac("sha256", secret).update(body).digest("hex");
  return `sha256=${mac}`;
}

export function verifyWebhookSignature(body: string, signature: string, secret: string): boolean {
  const expected = signWebhook(body, secret);
  if (expected.length !== signature.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}
```

- [ ] **Step 3: Run all** — `pnpm --filter @arc-fx/app test lib/auth lib/crypto` — expect 4 + 4 = 8 passed.

- [ ] **Step 4: Commit**

```bash
git -C /Users/huseyinarslan/arc-fx-gateway add packages/app/lib/auth/apikey.ts packages/app/lib/auth/apikey.test.ts packages/app/lib/crypto/webhook.ts packages/app/lib/crypto/webhook.test.ts
git -C /Users/huseyinarslan/arc-fx-gateway commit -m "feat(app): API key auth (bcrypt) + webhook HMAC helpers"
```

---

## Task 10: `POST /api/invoices` — server-paid invoice creation

**Files:**
- Create: `/Users/huseyinarslan/arc-fx-gateway/packages/app/lib/chain/client.ts`
- Create: `/Users/huseyinarslan/arc-fx-gateway/packages/app/lib/chain/gateway-abi.ts`
- Create: `/Users/huseyinarslan/arc-fx-gateway/packages/app/app/api/invoices/route.ts`
- Create: `/Users/huseyinarslan/arc-fx-gateway/packages/app/app/api/invoices/route.test.ts`

- [ ] **Step 1: `lib/chain/gateway-abi.ts`**

Export the ABI subset we use. Rather than copying the whole ABI by hand, generate it from the Foundry build:

```bash
cd /Users/huseyinarslan/arc-fx-gateway/packages/contracts
jq '.abi' out/ArcFXGateway.sol/ArcFXGateway.json > /tmp/gateway-abi.json
```

Then write `lib/chain/gateway-abi.ts`:
```ts
import abi from "../../../contracts/out/ArcFXGateway.sol/ArcFXGateway.json" with { type: "json" };
export const GATEWAY_ABI = abi.abi;
```

(`with { type: "json" }` import attribute is supported in Next.js + Node 20+.)

- [ ] **Step 2: `lib/chain/client.ts`**

```ts
import { createPublicClient, createWalletClient, http, type Address } from "viem";
import { defineChain } from "viem";
import { loadServerWallet } from "@/lib/wallet/server-wallet";

export const arcTestnet = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.ARC_TESTNET_RPC ?? "https://rpc.testnet.arc.network"] },
  },
  blockExplorers: { default: { name: "Arcscan", url: "https://testnet.arcscan.app" } },
});

export const publicClient = createPublicClient({
  chain: arcTestnet,
  transport: http(),
});

export async function getServerWalletClient() {
  const account = await loadServerWallet();
  return createWalletClient({ account, chain: arcTestnet, transport: http() });
}

export const GATEWAY: Address = process.env.GATEWAY_ADDRESS as Address;
```

- [ ] **Step 3: API route `POST /api/invoices` (TDD)**

`app/api/invoices/route.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "./route";

vi.mock("@/lib/auth/apikey", () => ({
  lookupMerchantByApiKey: vi.fn(),
}));
vi.mock("@/lib/chain/client", () => ({
  publicClient: { waitForTransactionReceipt: vi.fn().mockResolvedValue({ status: "success" }) },
  getServerWalletClient: vi.fn(),
  GATEWAY: "0xgw",
}));
vi.mock("@/lib/db/client", () => ({
  db: {
    insert: vi.fn(() => ({ values: vi.fn().mockResolvedValue(undefined) })),
  },
}));

beforeEach(() => { vi.clearAllMocks(); });

function makeReq(body: any, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/invoices", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  }) as any;
}

describe("POST /api/invoices", () => {
  it("rejects missing API key with 401", async () => {
    const res = await POST(makeReq({ amountUsdc: 1, payInToken: "EURC", successUrl: "https://x" }));
    expect(res.status).toBe(401);
  });

  it("rejects bad API key with 401", async () => {
    const m = await import("@/lib/auth/apikey");
    (m.lookupMerchantByApiKey as any).mockResolvedValue(null);
    const res = await POST(makeReq(
      { amountUsdc: 1, payInToken: "EURC", successUrl: "https://x" },
      { "X-Arc-Api-Key": "ak_live_bad" }
    ));
    expect(res.status).toBe(401);
  });

  it("creates invoice when key valid + chain tx succeeds", async () => {
    const apikey = await import("@/lib/auth/apikey");
    (apikey.lookupMerchantByApiKey as any).mockResolvedValue({
      id: "00000000-0000-0000-0000-000000000001",
      address: "0xmerchant",
      payoutToken: "0xusdc",
    });
    const chain = await import("@/lib/chain/client");
    const writeContract = vi.fn().mockResolvedValue("0xtxhash");
    (chain.getServerWalletClient as any).mockResolvedValue({ writeContract });

    const res = await POST(makeReq(
      { amountUsdc: 49.99, payInToken: "EURC", successUrl: "https://m/ok" },
      { "X-Arc-Api-Key": "ak_live_good" }
    ));
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.invoiceId).toMatch(/^0x[0-9a-f]{64}$/);
    expect(body.url).toContain(body.invoiceId);
    expect(writeContract).toHaveBeenCalled();
  });
});
```

`app/api/invoices/route.ts`:
```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { lookupMerchantByApiKey } from "@/lib/auth/apikey";
import { GATEWAY_ABI } from "@/lib/chain/gateway-abi";
import { GATEWAY, getServerWalletClient, publicClient } from "@/lib/chain/client";
import { db } from "@/lib/db/client";
import { invoices } from "@/lib/db/schema";
import type { Address, Hex } from "viem";

const Body = z.object({
  amountUsdc: z.number().positive(),
  payInToken: z.enum(["USDC", "EURC"]),
  successUrl: z.string().url(),
  cancelUrl: z.string().url().optional(),
  metadata: z.record(z.string()).optional(),
});

const TOKEN_ADDR = {
  USDC: process.env.USDC_ADDRESS as Address,
  EURC: process.env.EURC_ADDRESS as Address,
};

const INVOICE_TTL_SEC = 30 * 60;

export async function POST(req: NextRequest) {
  const apiKey = req.headers.get("X-Arc-Api-Key") ?? "";
  if (!apiKey) return NextResponse.json({ error: "missing_api_key" }, { status: 401 });
  const merchant = await lookupMerchantByApiKey(apiKey);
  if (!merchant) return NextResponse.json({ error: "invalid_api_key" }, { status: 401 });

  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "bad_body", detail: parsed.error.format() }, { status: 400 });
  const { amountUsdc, payInToken, successUrl, cancelUrl, metadata } = parsed.data;

  const invoiceId = ("0x" + randomBytes(32).toString("hex")) as Hex;
  const amountOut = BigInt(Math.round(amountUsdc * 1_000_000));
  const expiresAt = BigInt(Math.floor(Date.now() / 1000) + INVOICE_TTL_SEC);

  let txHash: Hex;
  try {
    const wallet = await getServerWalletClient();
    txHash = await wallet.writeContract({
      address: GATEWAY,
      abi: GATEWAY_ABI,
      functionName: "createInvoiceFor",
      args: [merchant.address, invoiceId, TOKEN_ADDR[payInToken], amountOut, expiresAt],
    });
    await publicClient.waitForTransactionReceipt({ hash: txHash });
  } catch (e: any) {
    if (/DelegateNotAuthorized/.test(e?.shortMessage ?? "")) {
      return NextResponse.json({ error: "delegate_not_authorized" }, { status: 412 });
    }
    return NextResponse.json({ error: "chain_error", detail: e?.shortMessage ?? String(e) }, { status: 502 });
  }

  await db.insert(invoices).values({
    id: invoiceId,
    merchantId: merchant.id,
    payInToken: TOKEN_ADDR[payInToken],
    amountOut: amountOut.toString(),
    expiresAt: new Date(Number(expiresAt) * 1000),
    status: "created",
    metadata: metadata ?? null,
    successUrl,
    cancelUrl: cancelUrl ?? null,
  });

  const baseUrl = process.env.PUBLIC_BASE_URL ?? "https://checkout.arc-fx.xyz";
  return NextResponse.json({ invoiceId, url: `${baseUrl}/i/${invoiceId}` }, { status: 201 });
}
```

- [ ] **Step 4: Run tests** — `pnpm --filter @arc-fx/app test app/api/invoices` — expect 3 passed.

- [ ] **Step 5: Commit**

```bash
git -C /Users/huseyinarslan/arc-fx-gateway add packages/app/lib/chain packages/app/app/api/invoices
git -C /Users/huseyinarslan/arc-fx-gateway commit -m "feat(app): POST /api/invoices — server-paid via createInvoiceFor"
```

---

## Task 11: `GET /api/invoices/:id` + `GET /api/quote`

**Files:**
- Create: `/Users/huseyinarslan/arc-fx-gateway/packages/app/app/api/invoices/[id]/route.ts`
- Create: `/Users/huseyinarslan/arc-fx-gateway/packages/app/app/api/invoices/[id]/route.test.ts`
- Create: `/Users/huseyinarslan/arc-fx-gateway/packages/app/lib/chain/pool-abi.ts`
- Create: `/Users/huseyinarslan/arc-fx-gateway/packages/app/app/api/quote/route.ts`
- Create: `/Users/huseyinarslan/arc-fx-gateway/packages/app/app/api/quote/route.test.ts`

- [ ] **Step 1: Tests for invoice GET**

`app/api/invoices/[id]/route.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "./route";

vi.mock("@/lib/db/client", () => ({
  db: { select: vi.fn() },
}));

beforeEach(() => { vi.clearAllMocks(); });

function ctx(id: string) { return { params: Promise.resolve({ id }) }; }

describe("GET /api/invoices/:id", () => {
  it("returns 404 for unknown invoice", async () => {
    const m = await import("@/lib/db/client");
    (m.db.select as any).mockReturnValue({
      from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }),
    });
    const res = await GET({} as any, ctx("0xnope"));
    expect(res.status).toBe(404);
  });

  it("returns invoice JSON for known id", async () => {
    const m = await import("@/lib/db/client");
    (m.db.select as any).mockReturnValue({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve([{
            id: "0x01", status: "created", amountOut: "100000",
            payInToken: "0xeurc", expiresAt: new Date(),
          }]),
        }),
      }),
    });
    const res = await GET({} as any, ctx("0x01"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.id).toBe("0x01");
    expect(body.status).toBe("created");
  });
});
```

- [ ] **Step 2: Implement invoice GET**

```ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { invoices } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const rows = await db.select().from(invoices).where(eq(invoices.id, id)).limit(1);
  if (rows.length === 0) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const inv = rows[0]!;
  return NextResponse.json({
    id: inv.id,
    status: inv.status,
    payInToken: inv.payInToken,
    amountOut: inv.amountOut,
    expiresAt: inv.expiresAt.toISOString(),
    paidBy: inv.paidBy,
    paidTx: inv.paidTx,
    paidAt: inv.paidAt?.toISOString() ?? null,
    metadata: inv.metadata,
  });
}
```

- [ ] **Step 3: `lib/chain/pool-abi.ts`**

```ts
export const POOL_ABI = [
  {
    type: "function",
    name: "calculateSwap",
    stateMutability: "view",
    inputs: [
      { name: "i", type: "uint8" },
      { name: "j", type: "uint8" },
      { name: "dx", type: "uint256" },
    ],
    outputs: [{ type: "uint256" }],
  },
] as const;
```

- [ ] **Step 4: Tests for quote**

`app/api/quote/route.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "./route";

vi.mock("@/lib/chain/client", () => ({
  publicClient: { readContract: vi.fn() },
  POOL: "0xpool",
}));

beforeEach(() => { vi.clearAllMocks(); });

function urlFor(qs: string) { return new Request(`http://localhost/api/quote?${qs}`) as any; }

describe("GET /api/quote", () => {
  it("rejects missing params with 400", async () => {
    const res = await GET(urlFor(""));
    expect(res.status).toBe(400);
  });

  it("returns calculateSwap result for EURC→USDC", async () => {
    const m = await import("@/lib/chain/client");
    (m.publicClient.readContract as any).mockResolvedValue(108587n);
    const res = await GET(urlFor("from=EURC&to=USDC&amountIn=100000"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.amountOut).toBe("108587");
  });
});
```

- [ ] **Step 5: Implement quote**

`app/api/quote/route.ts`:
```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { POOL_ABI } from "@/lib/chain/pool-abi";
import { publicClient, POOL } from "@/lib/chain/client";
import type { Address } from "viem";

const Q = z.object({
  from: z.enum(["USDC", "EURC"]),
  to: z.enum(["USDC", "EURC"]),
  amountIn: z.coerce.bigint(),
});

const TOKEN_INDEX = { USDC: 0, EURC: 1 } as const;

export async function GET(req: NextRequest) {
  const params = Object.fromEntries(new URL(req.url).searchParams);
  const parsed = Q.safeParse(params);
  if (!parsed.success) return NextResponse.json({ error: "bad_params" }, { status: 400 });
  const { from, to, amountIn } = parsed.data;
  if (from === to) return NextResponse.json({ error: "same_token" }, { status: 400 });

  const out = await publicClient.readContract({
    address: process.env.POOL_ADDRESS as Address,
    abi: POOL_ABI,
    functionName: "calculateSwap",
    args: [TOKEN_INDEX[from], TOKEN_INDEX[to], amountIn],
  });
  return NextResponse.json({ from, to, amountIn: amountIn.toString(), amountOut: out.toString() });
}
```

Note: also export `POOL` from `lib/chain/client.ts` (it currently exports `GATEWAY` only):
```ts
export const POOL: Address = process.env.POOL_ADDRESS as Address;
```

- [ ] **Step 6: Run all** — `pnpm --filter @arc-fx/app test app/api` — expect 5 passed (3 invoices + 2 quote).

- [ ] **Step 7: Commit**

```bash
git -C /Users/huseyinarslan/arc-fx-gateway add packages/app/app/api/invoices/[id] packages/app/app/api/quote packages/app/lib/chain/pool-abi.ts packages/app/lib/chain/client.ts
git -C /Users/huseyinarslan/arc-fx-gateway commit -m "feat(app): GET /api/invoices/:id + GET /api/quote"
```

---

## Task 12: Indexer + webhook dispatcher (Vercel Cron)

**Files:**
- Create: `/Users/huseyinarslan/arc-fx-gateway/packages/app/app/api/cron/index-events/route.ts`
- Create: `/Users/huseyinarslan/arc-fx-gateway/packages/app/app/api/cron/index-events/route.test.ts`
- Create: `/Users/huseyinarslan/arc-fx-gateway/packages/app/app/api/cron/dispatch-webhooks/route.ts`
- Create: `/Users/huseyinarslan/arc-fx-gateway/packages/app/app/api/cron/dispatch-webhooks/route.test.ts`
- Create: `/Users/huseyinarslan/arc-fx-gateway/packages/app/vercel.json`

- [ ] **Step 1: `vercel.json`**

```json
{
  "crons": [
    { "path": "/api/cron/index-events",      "schedule": "*/1 * * * *" },
    { "path": "/api/cron/dispatch-webhooks", "schedule": "*/1 * * * *" }
  ]
}
```

(Vercel Hobby plan supports minute granularity.)

- [ ] **Step 2: Indexer route (test first)**

`app/api/cron/index-events/route.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "./route";

vi.mock("@/lib/chain/client", () => ({
  publicClient: { getBlockNumber: vi.fn(), getLogs: vi.fn() },
  GATEWAY: "0xgw",
}));
vi.mock("@/lib/db/client", () => ({
  db: { select: vi.fn(), insert: vi.fn(), update: vi.fn() },
}));

beforeEach(() => { vi.clearAllMocks(); });
process.env.CRON_SECRET = "secret";

function authReq() {
  return new Request("http://localhost/api/cron/index-events", {
    method: "POST",
    headers: { authorization: "Bearer secret" },
  }) as any;
}

describe("POST /api/cron/index-events", () => {
  it("rejects unauthorized", async () => {
    const res = await POST(new Request("http://localhost/api/cron/index-events", { method: "POST" }) as any);
    expect(res.status).toBe(401);
  });

  it("scans new blocks and updates indexer state", async () => {
    const chain = await import("@/lib/chain/client");
    (chain.publicClient.getBlockNumber as any).mockResolvedValue(1000n);
    (chain.publicClient.getLogs as any).mockResolvedValue([]);

    const dbMod = await import("@/lib/db/client");
    (dbMod.db.select as any).mockReturnValue({
      from: () => ({ where: () => ({ limit: () => Promise.resolve([{ key: "last_processed_block", value: "990" }]) }) }),
    });
    (dbMod.db.update as any).mockReturnValue({ set: () => ({ where: () => Promise.resolve(undefined) }) });

    const res = await POST(authReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.from).toBe(991);
    expect(body.to).toBe(995);                  // 1000 - 5 reorg buffer
  });
});
```

- [ ] **Step 3: Implement indexer**

`app/api/cron/index-events/route.ts`:
```ts
import { NextRequest, NextResponse } from "next/server";
import { publicClient, GATEWAY } from "@/lib/chain/client";
import { db } from "@/lib/db/client";
import { invoices, indexerState, webhookAttempts, merchants } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { decodeEventLog, parseAbi } from "viem";

const REORG_BUFFER = Number(process.env.INDEXER_REORG_BUFFER_BLOCKS ?? 5);

const InvoicePaidAbi = parseAbi([
  "event InvoicePaid(bytes32 indexed id, address indexed payer, uint256 amountIn, uint256 amountOut, uint256 fee)",
]);

export async function POST(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const stateRows = await db.select().from(indexerState).where(eq(indexerState.key, "last_processed_block")).limit(1);
  const last = stateRows[0] ? BigInt(stateRows[0].value) : 0n;
  const head = await publicClient.getBlockNumber();
  const toBlock = head - BigInt(REORG_BUFFER);
  const fromBlock = last + 1n;
  if (fromBlock > toBlock) {
    return NextResponse.json({ from: Number(fromBlock), to: Number(toBlock), processed: 0 });
  }

  const logs = await publicClient.getLogs({
    address: GATEWAY,
    event: InvoicePaidAbi[0],
    fromBlock,
    toBlock,
  });

  for (const log of logs) {
    const decoded = decodeEventLog({ abi: InvoicePaidAbi, data: log.data, topics: log.topics });
    const { id, payer } = decoded.args;
    await db.update(invoices)
      .set({ status: "paid", paidBy: payer, paidTx: log.transactionHash, paidAt: new Date() })
      .where(eq(invoices.id, id as string));

    const invRow = (await db.select().from(invoices).where(eq(invoices.id, id as string)).limit(1))[0];
    if (invRow) {
      const m = (await db.select().from(merchants).where(eq(merchants.id, invRow.merchantId)).limit(1))[0];
      if (m?.webhookUrl) {
        await db.insert(webhookAttempts).values({
          invoiceId: invRow.id,
          url: m.webhookUrl,
          payload: {
            event_id: crypto.randomUUID(),
            type: "invoice.paid",
            invoice_id: invRow.id,
            paid_by: payer,
            tx_hash: log.transactionHash,
          },
          attempts: 0,
          nextAttempt: new Date(),
        });
      }
    }
  }

  if (stateRows[0]) {
    await db.update(indexerState).set({ value: toBlock.toString(), updatedAt: new Date() })
      .where(eq(indexerState.key, "last_processed_block"));
  } else {
    await db.insert(indexerState).values({ key: "last_processed_block", value: toBlock.toString() });
  }

  return NextResponse.json({ from: Number(fromBlock), to: Number(toBlock), processed: logs.length });
}
```

- [ ] **Step 4: Webhook dispatcher (test first)**

`app/api/cron/dispatch-webhooks/route.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "./route";

vi.mock("@/lib/db/client", () => ({
  db: { select: vi.fn(), update: vi.fn() },
}));
vi.mock("@/lib/crypto/secret", () => ({
  decrypt: vi.fn().mockReturnValue("whsec_test"),
}));

global.fetch = vi.fn();
process.env.CRON_SECRET = "secret";

function authReq() {
  return new Request("http://localhost/api/cron/dispatch-webhooks", {
    method: "POST",
    headers: { authorization: "Bearer secret" },
  }) as any;
}

beforeEach(() => { vi.clearAllMocks(); });

describe("POST /api/cron/dispatch-webhooks", () => {
  it("delivers a pending webhook and marks it succeeded", async () => {
    const dbMod = await import("@/lib/db/client");
    (dbMod.db.select as any).mockReturnValue({
      from: () => ({ where: () => ({ limit: () => Promise.resolve([
        { id: "att-1", invoiceId: "0x01", url: "https://merchant/hook", payload: { x: 1 }, attempts: 0,
          merchantSecretEnc: Buffer.alloc(48), merchantSecretIv: Buffer.alloc(12) },
      ]) }) }),
    });
    (dbMod.db.update as any).mockReturnValue({ set: () => ({ where: () => Promise.resolve(undefined) }) });
    (global.fetch as any).mockResolvedValue(new Response("ok", { status: 200 }));

    const res = await POST(authReq());
    expect(res.status).toBe(200);
    expect(global.fetch).toHaveBeenCalledWith("https://merchant/hook", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ "X-Arc-Signature": expect.stringMatching(/^sha256=/) }),
    }));
  });
});
```

- [ ] **Step 5: Implement webhook dispatcher**

`app/api/cron/dispatch-webhooks/route.ts`:
```ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { webhookAttempts, merchants, invoices } from "@/lib/db/schema";
import { and, eq, isNull, lte, sql } from "drizzle-orm";
import { signWebhook } from "@/lib/crypto/webhook";
import { decrypt } from "@/lib/crypto/secret";

const BATCH = 50;
const MAX_BACKOFF_HOURS = 24;
const TERMINAL_4XX_AFTER = 3;

export async function POST(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const rows = await db
    .select({
      id: webhookAttempts.id,
      invoiceId: webhookAttempts.invoiceId,
      url: webhookAttempts.url,
      payload: webhookAttempts.payload,
      attempts: webhookAttempts.attempts,
      enc: merchants.webhookSecretEnc,
      iv: merchants.webhookSecretIv,
    })
    .from(webhookAttempts)
    .innerJoin(invoices, eq(invoices.id, webhookAttempts.invoiceId))
    .innerJoin(merchants, eq(merchants.id, invoices.merchantId))
    .where(and(isNull(webhookAttempts.succeededAt), lte(webhookAttempts.nextAttempt, new Date())))
    .limit(BATCH);

  let delivered = 0;
  for (const row of rows) {
    const secret = decrypt(row.iv as Buffer, row.enc as Buffer);
    const body = JSON.stringify(row.payload);
    const signature = signWebhook(body, secret);
    let ok = false;
    let lastError: string | undefined;
    let status = 0;
    try {
      const res = await fetch(row.url, {
        method: "POST",
        headers: { "content-type": "application/json", "X-Arc-Signature": signature },
        body,
      });
      status = res.status;
      ok = res.ok;
      if (!ok) lastError = `${res.status} ${res.statusText}`;
    } catch (e: any) {
      lastError = e?.message ?? "network";
    }

    if (ok) {
      delivered++;
      await db.update(webhookAttempts)
        .set({ succeededAt: new Date() })
        .where(eq(webhookAttempts.id, row.id));
      continue;
    }

    const newAttempts = row.attempts + 1;
    if (status >= 400 && status < 500 && newAttempts >= TERMINAL_4XX_AFTER) {
      await db.update(webhookAttempts)
        .set({ attempts: newAttempts, lastError, nextAttempt: new Date(Date.now() + MAX_BACKOFF_HOURS * 3600 * 1000) })
        .where(eq(webhookAttempts.id, row.id));
    } else {
      const backoffSec = Math.min(2 ** newAttempts, MAX_BACKOFF_HOURS * 3600);
      await db.update(webhookAttempts)
        .set({ attempts: newAttempts, lastError, nextAttempt: new Date(Date.now() + backoffSec * 1000) })
        .where(eq(webhookAttempts.id, row.id));
    }
  }

  return NextResponse.json({ scanned: rows.length, delivered });
}
```

- [ ] **Step 6: Run cron tests**

Run: `pnpm --filter @arc-fx/app test app/api/cron`
Expected: 3 passed (1 indexer + 2 dispatcher).

- [ ] **Step 7: Full app test run**

```bash
cd /Users/huseyinarslan/arc-fx-gateway/packages/app && pnpm test
```
Expected: ~25-30 passed, 0 failed.

- [ ] **Step 8: Commit**

```bash
git -C /Users/huseyinarslan/arc-fx-gateway add packages/app/app/api/cron packages/app/vercel.json
git -C /Users/huseyinarslan/arc-fx-gateway commit -m "feat(app): cron jobs — index-events + dispatch-webhooks"
```

---

## Done criteria — Plan 2a complete when:

- [ ] All 12 tasks committed.
- [ ] `forge test` shows 63 contract tests passing (was 57, plus 6 new for v0.3 functions).
- [ ] Gateway v0.3.0 deployed to Arc testnet, recorded in `deployments/arc-testnet.json`.
- [ ] `pnpm --filter @arc-fx/app test` shows ≥ 25 passing.
- [ ] `pnpm --filter @arc-fx/checkout test` shows 8 passing.
- [ ] `pnpm --filter @arc-fx/checkout-react test` shows 3 passing.
- [ ] SDK builds to ESM + CJS + types in `packages/sdk/dist`.
- [ ] All packages typecheck clean: `pnpm -r typecheck`.

**Then:** Plan 2b (Frontend + E2E + Vercel deploy + Demo + README) takes over.

---

## Self-Review Notes

- **Spec coverage:** Components 4.1 (SDK in Task 6), 4.2 routes (API portion in Tasks 8/10/11/12 — UI in Plan 2b), 4.3 schema (Task 4), 4.4 indexer + dispatcher (Task 12), 4.5 hot wallet (Task 5), 4.6 v0.3 extension (Task 1). Flow §5.1 onboarding, §5.2 invoice creation, §5.4 indexer, §5.5 dispatcher all map to tasks here. UI flows §5.1 (UI portion) and §5.3 (customer payment) deferred to Plan 2b. Error mapping in §6 wired into route handlers.
- **Type consistency:** `merchantId` (uuid), `invoiceId` (text bytes32 hex), `Address` (Hex), `BigInt` for amount and block numbers — used identically across schema (Task 4), API routes (Tasks 10/11/12), and SDK types (Task 6).
- **Function names:** `lookupMerchantByApiKey`, `loadServerWallet`, `getServerWalletClient`, `signWebhook`, `verifySiweMessage`, `generateNonce` — used consistently in tests + implementations.
- **Open issue I won't fix here:** `lookupMerchantByApiKey` is O(N merchants) due to bcrypt-per-row. Acceptable at demo scale; production should switch to a hash-prefix index or HMAC-key comparison.
