/**
 * Arcora relayer daemon (v0.8). Drains `relayer_queue`, runs `kit.swap` on
 * Arc, and tells `ArcFXGatewayV8.settleInvoice` to deliver the merchant
 * payout. On swap failure, refunds the customer off-chain and records the
 * failure on the gateway so the indexer/webhook flow surfaces it.
 *
 * Flow per row (one at a time — keeps the hot wallet's nonce sane on a
 * single VPS without coordination machinery):
 *   pending  ─▶ processing  ─┐
 *                            ├─ Permit2.permitTransferFrom (payer → relayer)
 *                            ├─ kit.swap (payIn → payoutToken)  ──fail──▶ refund
 *                            ├─ ERC20.approve(gateway, gross)
 *                            ├─ gateway.settleInvoice
 *                            └─▶ settled
 *   refund:    ERC20.transfer(payer, amountIn)
 *              ├─ gateway.recordPayerRefund
 *              └─▶ refunded
 *
 * Env: see .env.example.
 */

import {
  createPublicClient, createWalletClient, http, parseAbi,
  type Address, type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { AppKit } from "@circle-fin/app-kit";
import { createViemAdapterFromPrivateKey } from "@circle-fin/adapter-viem-v2";
import pg from "pg";

const RPC          = need("ARC_TESTNET_RPC");
const PG_URL       = need("POSTGRES_URL_NON_POOLING");
const PRIVATE_KEY  = need("RELAYER_PRIVATE_KEY") as Hex;
const KIT_KEY      = need("KIT_KEY");
const GATEWAY      = need("GATEWAY_ADDRESS").toLowerCase() as Address;
const PERMIT2      = (process.env.PERMIT2_ADDRESS ?? "0x000000000022D473030F116dDEE9F6B43aC78BA3").toLowerCase() as Address;
const FEE_RECIPIENT = need("CUSTOM_FEE_RECIPIENT") as Address;
const CUSTOM_FEE_BPS = Number(process.env.CUSTOM_FEE_BPS ?? "100"); // 1% default
const SLIPPAGE_BPS = Number(process.env.SLIPPAGE_BPS ?? "100");     // 1% default
const TICK_MS      = Number(process.env.RELAYER_TICK_MS ?? "5000");
const MAX_ATTEMPTS = Number(process.env.RELAYER_MAX_ATTEMPTS ?? "3");
// A row stuck in `processing` beyond this window is treated as crashed mid-
// flight (prev daemon died after permit2 pull / between swap + settle, etc.)
// and reclaimed by the next claimNext call. Set generously above worst-case
// kit.swap + settle latency. Audit P2 #5, 2026-05-03.
const LEASE_SECONDS = Number(process.env.RELAYER_LEASE_SECONDS ?? "480"); // 8 min

function need(k: string): string {
  const v = process.env[k];
  if (!v) throw new Error(`missing env ${k}`);
  return v;
}

// ── ABIs ─────────────────────────────────────────────────────────────

const ERC20 = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function transfer(address,uint256) returns (bool)",
]);

const GATEWAY_ABI = parseAbi([
  "function settleInvoice(bytes32 globalId, address payer, address payInToken, uint256 amountIn, uint256 grossPayout, bytes32 swapTxHash)",
  "function recordPayerRefund(bytes32 globalId, address payer, address payInToken, uint256 amount, bytes32 reasonHash)",
]);

// Permit2 SignatureTransfer surface. The `witness` flavour lets us bind the
// signed message to the trade context (invoice id + relayer address).
const PERMIT2_ABI = parseAbi([
  "struct TokenPermissions { address token; uint256 amount; }",
  "struct PermitTransferFrom { TokenPermissions permitted; uint256 nonce; uint256 deadline; }",
  "struct SignatureTransferDetails { address to; uint256 requestedAmount; }",
  "function permitWitnessTransferFrom(PermitTransferFrom permit, SignatureTransferDetails transferDetails, address owner, bytes32 witness, string witnessTypeString, bytes signature)",
]);

const chain  = createPublicClient({ transport: http(RPC) });
const wallet = createWalletClient({ account: privateKeyToAccount(PRIVATE_KEY), transport: http(RPC) });
const kit    = new AppKit();
const adapter = createViemAdapterFromPrivateKey({ privateKey: PRIVATE_KEY });
const RELAYER_ADDR = privateKeyToAccount(PRIVATE_KEY).address;

const pool = new pg.Pool({ connectionString: PG_URL, ssl: { rejectUnauthorized: false } });

// ── Queue row shape ─────────────────────────────────────────────────

type QueueRow = {
  id: string;
  invoice_id: string;
  payer: string;
  pay_in_token: string;
  amount_in: string;
  payout_token: string;
  amount_out_min: string;
  permit2_data: {
    nonce: string;
    deadline: string;
    witness: Hex;
    witnessTypeString: string;
  };
  permit2_signature: Hex;
  attempts: number;
  gateway_address: string | null;
};

/** Plan-9 dispatch — every queue row carries the gateway address its invoice
 *  was created against. settleInvoice + recordPayerRefund get routed there.
 *  Legacy rows without gateway_address fall back to the daemon's default. */
function gatewayFor(row: QueueRow): Address {
  const addr = (row.gateway_address ?? GATEWAY).toLowerCase();
  return addr as Address;
}

// ── Token symbol resolution for kit.swap ────────────────────────────
// App Kit takes ticker symbols, not addresses. Maintain a small lookup
// from on-chain address → ticker. This is testnet-only; mainnet builds
// out from the wider Arc address book.
const TOKEN_SYMBOL: Record<string, "USDC" | "EURC"> = {
  "0x3600000000000000000000000000000000000000": "USDC",
  "0x89b50855aa3be2f677cd6303cec089b5f319d72a": "EURC",
};

function tokenSymbol(addr: string): "USDC" | "EURC" {
  const sym = TOKEN_SYMBOL[addr.toLowerCase()];
  if (!sym) throw new Error(`relayer.unknown_token: ${addr}`);
  return sym;
}

// ── DB helpers ──────────────────────────────────────────────────────

/** SQL fragment for atomic claim that also surfaces invoices.gateway_address
 *  for per-row dispatch (Plan 9). The CTE + `for update skip locked` keeps
 *  two relayer instances from grabbing the same row even though we run one
 *  daemon today. */
function claimSql(where: string): string {
  return `with claimed as (
            update relayer_queue
               set status     = 'processing',
                   attempts   = attempts + 1,
                   updated_at = now()
             where id = (
               select id from relayer_queue
                where ${where}
                order by next_attempt
                limit 1
                for update skip locked
             )
             returning id, invoice_id, payer, pay_in_token, amount_in, payout_token,
                       amount_out_min, permit2_data, permit2_signature, attempts
          )
          select c.*, i.gateway_address
            from claimed c
            left join invoices i on i.id = c.invoice_id`;
}

async function claimNext(): Promise<QueueRow | null> {
  // Audit P2 #5 (2026-05-03) — two-step claim:
  //
  //   1. Reclaim any row stuck in `processing` beyond the lease window. A
  //      daemon crash after Permit2 pull but before mark-settled/refunded
  //      leaves a row invisible to plain pending claims; this rescues those
  //      so customer funds (potentially in the relayer hot wallet) can
  //      finish flowing.
  //   2. Otherwise, claim a normal pending row.
  //
  // The lease reclaim still increments `attempts`, so chronic stuck rows
  // hit MAX_ATTEMPTS and surface for operator investigation rather than
  // silently retrying forever.
  const reclaim = await pool.query<QueueRow>(
    claimSql(`status = 'processing' and updated_at < now() - ($1 || ' seconds')::interval`),
    [String(LEASE_SECONDS)],
  );
  if (reclaim.rows[0]) {
    const row = reclaim.rows[0];
    console.warn(
      `relayer.lease_reclaimed id=${row.id} invoice=${row.invoice_id} attempts=${row.attempts} ` +
      `lease_seconds=${LEASE_SECONDS} — previous daemon crashed mid-flight; resuming.`,
    );
    return row;
  }

  const pending = await pool.query<QueueRow>(
    claimSql(`status = 'pending' and next_attempt <= now()`),
  );
  return pending.rows[0] ?? null;
}

async function markSettled(id: string, swapTx: Hex, settleTx: Hex): Promise<void> {
  await pool.query(
    `update relayer_queue
        set status = 'settled', swap_tx_hash = $2, settle_tx_hash = $3,
            updated_at = now()
      where id = $1`,
    [id, swapTx, settleTx],
  );
}

async function markRefunded(id: string, refundTx: Hex, lastError: string): Promise<void> {
  await pool.query(
    `update relayer_queue
        set status = 'refunded', refund_tx_hash = $2, last_error = $3,
            updated_at = now()
      where id = $1`,
    [id, refundTx, lastError],
  );
}

async function markFailed(id: string, lastError: string): Promise<void> {
  // Terminal: we couldn't even get the customer's pay-in back. Operator
  // intervention required — replay.ts can re-queue once the upstream
  // problem is fixed.
  await pool.query(
    `update relayer_queue
        set status = 'failed', last_error = $2, updated_at = now()
      where id = $1`,
    [id, lastError],
  );
}

async function reschedule(id: string, lastError: string, attempts: number): Promise<void> {
  if (attempts >= MAX_ATTEMPTS) {
    await markFailed(id, `max attempts (${MAX_ATTEMPTS}) reached: ${lastError}`);
    return;
  }
  const backoffSec = Math.min(2 ** attempts * 30, 30 * 60); // 30s, 60s, 120s, …, capped at 30 min
  await pool.query(
    `update relayer_queue
        set status = 'pending', last_error = $2,
            next_attempt = now() + ($3 || ' seconds')::interval,
            updated_at = now()
      where id = $1`,
    [id, lastError, backoffSec],
  );
}

// ── On-chain step helpers ───────────────────────────────────────────

async function pullViaPermit2(row: QueueRow): Promise<Hex> {
  // Permit2 permitWitnessTransferFrom: pulls amountIn of payInToken from
  // payer → relayer wallet, atomically validating the customer's signature
  // and the witness binding.
  const tx = await wallet.writeContract({
    chain: undefined,
    address: PERMIT2 as Address,
    abi: PERMIT2_ABI,
    functionName: "permitWitnessTransferFrom",
    args: [
      {
        permitted: {
          token:  row.pay_in_token as Address,
          amount: BigInt(row.amount_in),
        },
        nonce:    BigInt(row.permit2_data.nonce),
        deadline: BigInt(row.permit2_data.deadline),
      },
      {
        to:              RELAYER_ADDR,
        requestedAmount: BigInt(row.amount_in),
      },
      row.payer as Address,
      row.permit2_data.witness,
      row.permit2_data.witnessTypeString,
      row.permit2_signature,
    ],
  });
  await chain.waitForTransactionReceipt({ hash: tx });
  return tx;
}

async function runSwap(row: QueueRow): Promise<{ amountOut: string; txHash: Hex }> {
  const tokenIn  = tokenSymbol(row.pay_in_token);
  const tokenOut = tokenSymbol(row.payout_token);
  const amountInHumanReadable = humanizeAmount(row.amount_in, tokenIn);

  const result = await kit.swap({
    from: { adapter, chain: "Arc_Testnet" as const },
    tokenIn, tokenOut,
    amountIn: amountInHumanReadable,
    config: {
      kitKey:      KIT_KEY,
      slippageBps: SLIPPAGE_BPS,
      customFee:   { percentageBps: CUSTOM_FEE_BPS, recipientAddress: FEE_RECIPIENT },
    },
  });
  const r = result as { amountOut?: string; txHash: Hex };
  if (!r.amountOut) throw new Error("kit.swap returned no amountOut");
  return { amountOut: r.amountOut, txHash: r.txHash };
}

async function callSettle(
  row: QueueRow,
  grossPayoutBaseUnits: bigint,
  swapTxHash: Hex,
): Promise<Hex> {
  // The relayer holds payoutToken in its hot wallet now. Approve the gateway
  // to pull `grossPayoutBaseUnits`, then call settleInvoice.
  const targetGateway = gatewayFor(row);

  const approveTx = await wallet.writeContract({
    chain: undefined,
    address: row.payout_token as Address,
    abi: ERC20,
    functionName: "approve",
    args: [targetGateway, grossPayoutBaseUnits],
  });
  await chain.waitForTransactionReceipt({ hash: approveTx });

  const tx = await wallet.writeContract({
    chain: undefined,
    address: targetGateway,
    abi: GATEWAY_ABI,
    functionName: "settleInvoice",
    args: [
      row.invoice_id as Hex,
      row.payer as Address,
      row.pay_in_token as Address,
      BigInt(row.amount_in),
      grossPayoutBaseUnits,
      swapTxHash,
    ],
  });
  await chain.waitForTransactionReceipt({ hash: tx });
  return tx;
}

async function refundPayer(row: QueueRow, reason: string): Promise<Hex> {
  // Best-effort: if the relayer wallet never received the pay-in (Permit2
  // call itself failed before any token movement), there's nothing to send
  // back — just record the failure.
  const balance = await chain.readContract({
    address: row.pay_in_token as Address,
    abi: ERC20,
    functionName: "balanceOf",
    args: [RELAYER_ADDR],
  });
  const owedBack = BigInt(row.amount_in);
  if (balance < owedBack) {
    throw new Error(`insufficient pay-in balance to refund: have ${balance}, need ${owedBack}`);
  }

  const transferTx = await wallet.writeContract({
    chain: undefined,
    address: row.pay_in_token as Address,
    abi: ERC20,
    functionName: "transfer",
    args: [row.payer as Address, owedBack],
  });
  await chain.waitForTransactionReceipt({ hash: transferTx });

  // Tell the gateway: the indexer flips the invoice to `failed` from this event.
  const reasonHash = ("0x" +
    Array.from(new TextEncoder().encode(reason.slice(0, 32)))
      .map(b => b.toString(16).padStart(2, "0")).join("")
      .padEnd(64, "0")
  ) as Hex;
  const recordTx = await wallet.writeContract({
    chain: undefined,
    address: gatewayFor(row),
    abi: GATEWAY_ABI,
    functionName: "recordPayerRefund",
    args: [
      row.invoice_id as Hex,
      row.payer as Address,
      row.pay_in_token as Address,
      owedBack,
      reasonHash,
    ],
  });
  await chain.waitForTransactionReceipt({ hash: recordTx });
  return transferTx;
}

// USDC and EURC on Arc testnet are both 6-decimal in their ERC-20 surface;
// kit.swap takes human-readable strings ("0.50") so we format from base
// units back to decimal here. Hard-coded for now — extend when we onboard
// tokens with different decimals.
function humanizeAmount(baseUnits: string, _symbol: "USDC" | "EURC"): string {
  const decimals = 6n;
  const base = BigInt(baseUnits);
  const whole = base / 10n ** decimals;
  const frac  = (base % 10n ** decimals).toString().padStart(Number(decimals), "0").replace(/0+$/, "");
  return frac.length === 0 ? whole.toString() : `${whole.toString()}.${frac}`;
}

// ── Main loop ───────────────────────────────────────────────────────

async function processOne(row: QueueRow): Promise<void> {
  const log = (level: string, fields: Record<string, unknown>) => {
    console.log(JSON.stringify({
      ts: new Date().toISOString(), level, queueId: row.id,
      invoiceId: row.invoice_id, attempt: row.attempts, ...fields,
    }));
  };

  log("info", { msg: "row.claimed" });

  // Step 1: pull pay-in via Permit2.
  let pullTx: Hex;
  try {
    pullTx = await pullViaPermit2(row);
    log("info", { msg: "permit2.ok", tx: pullTx });
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    log("error", { msg: "permit2.fail", err });
    await reschedule(row.id, `permit2: ${err}`, row.attempts);
    return;
  }

  // Step 2: swap (skipped when payIn == payout — App Kit refuses identical
  // legs with "Swap from USDC to USDC ... not supported" and the customer
  // ends up refunded for a payment that should have settled directly).
  const sameToken = row.pay_in_token.toLowerCase() === row.payout_token.toLowerCase();
  let grossPayout: bigint;
  let swapTxHash:  Hex;

  if (sameToken) {
    grossPayout = BigInt(row.amount_in);
    swapTxHash  = "0x0000000000000000000000000000000000000000000000000000000000000000" as Hex;
    log("info", { msg: "swap.skip", reason: "same-token", grossPayout: grossPayout.toString() });
  } else {
    try {
      const swap = await runSwap(row);
      grossPayout = parseHumanAmount(swap.amountOut, 6);
      swapTxHash  = swap.txHash;
      log("info", { msg: "swap.ok", tx: swap.txHash, amountOut: swap.amountOut });
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      log("error", { msg: "swap.fail", err });
      try {
        const refundTx = await refundPayer(row, err);
        await markRefunded(row.id, refundTx, err);
        log("info", { msg: "refund.ok", tx: refundTx });
      } catch (re) {
        const rerr = re instanceof Error ? re.message : String(re);
        log("error", { msg: "refund.fail", err: rerr });
        await markFailed(row.id, `swap=${err}; refund=${rerr}`);
      }
      return;
    }
  }

  // Step 3: settle.
  try {
    if (grossPayout < BigInt(row.amount_out_min)) {
      throw new Error(`gross ${grossPayout} below floor ${row.amount_out_min}`);
    }
    const settleTx = await callSettle(row, grossPayout, swapTxHash);
    await markSettled(row.id, swapTxHash, settleTx);
    log("info", { msg: "settle.ok", tx: settleTx, gross: grossPayout.toString() });
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    log("error", { msg: "settle.fail", err });
    // Settlement failed but we already swapped; refund flow needs payInToken
    // which we no longer hold. Mark failed for operator review (rare path —
    // would mean the gateway reverted, e.g. invoice expired between submit
    // and settle).
    await markFailed(row.id, `settle: ${err} (post-swap, manual reconciliation needed)`);
  }
}

function parseHumanAmount(amount: string, decimals: number): bigint {
  const [whole, frac = ""] = amount.split(".");
  const fracPadded = frac.padEnd(decimals, "0").slice(0, decimals);
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fracPadded || "0");
}

async function main() {
  console.log(JSON.stringify({
    msg: "relayer.start",
    relayer: RELAYER_ADDR,
    gateway: GATEWAY,
    tickMs: TICK_MS,
    customFeeBps: CUSTOM_FEE_BPS,
    slippageBps: SLIPPAGE_BPS,
  }));

  const stop = async () => { await pool.end().catch(() => {}); process.exit(0); };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  while (true) {
    try {
      const row = await claimNext();
      if (row) {
        await processOne(row);
        continue; // back to the top — drain anything else queued
      }
    } catch (e) {
      console.error(JSON.stringify({
        ts: new Date().toISOString(), msg: "tick.error",
        error: e instanceof Error ? e.message : String(e),
      }));
    }
    await new Promise(r => setTimeout(r, TICK_MS));
  }
}

main();
