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
import { fetchPrivateKeyFromVault } from "./vault-signer";

const RPC           = need("ARC_TESTNET_RPC");
const PG_URL        = need("POSTGRES_URL_NON_POOLING");
const KIT_KEY       = need("KIT_KEY");
const GATEWAY       = need("GATEWAY_ADDRESS").toLowerCase() as Address;
const PERMIT2       = (process.env.PERMIT2_ADDRESS ?? "0x000000000022D473030F116dDEE9F6B43aC78BA3").toLowerCase() as Address;
const FEE_RECIPIENT = need("CUSTOM_FEE_RECIPIENT") as Address;
const CUSTOM_FEE_BPS = Number(process.env.CUSTOM_FEE_BPS ?? "100"); // 1% default
const SLIPPAGE_BPS  = Number(process.env.SLIPPAGE_BPS ?? "100");    // 1% default
const TICK_MS       = Number(process.env.RELAYER_TICK_MS ?? "5000");
const MAX_ATTEMPTS  = Number(process.env.RELAYER_MAX_ATTEMPTS ?? "3");
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

// V10 (audit M1 partial): relayer key fetched once from Vault KV-v2 at boot.
// AppRole-authenticated, audit-logged, encrypted at rest. The same fetched
// key feeds (a) the gateway-signing LocalAccount and (b) the AppKit swap
// adapter, so the raw key never lives on disk in any env file.
//
// Single fetch: previously called fetchPrivateKeyFromVault + vaultSigner
// (which itself called fetchPrivateKeyFromVault) — two AppRole logins +
// two KV reads on boot, with a small race window if secret_id rotated
// between them. Now one fetch, both consumers derive from the same key.
// Audit #17 (2026-05-12).
const _vaultOpts = {
  vaultUrl: need("VAULT_URL"),
  roleId:   need("VAULT_ROLE_ID"),
  secretId: need("VAULT_SECRET_ID"),
  kvPath:   need("VAULT_KV_PATH"),
  kvField:  process.env.VAULT_KV_FIELD ?? "privateKey",
};
const _relayerKey = await fetchPrivateKeyFromVault(_vaultOpts);
const account = privateKeyToAccount(_relayerKey);
const RELAYER_ADDR = account.address;
const wallet = createWalletClient({ account, transport: http(RPC) });
const adapter = createViemAdapterFromPrivateKey({ privateKey: _relayerKey });

const chain = createPublicClient({ transport: http(RPC) });
const kit   = new AppKit();

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
  // Stage progress markers — populated by persistPermit2Tx / persistSwapTx
  // / markSettled / markRefunded as each step succeeds. claimNext re-reads
  // them on reclaim so processOne knows where to resume. Audit P1 #3.
  permit2_tx_hash: string | null;
  swap_tx_hash:    string | null;
  /** Exact kit.swap amountOut in base units of payoutToken — persisted
   *  alongside swap_tx_hash so resume can use the real gross instead of
   *  conservatively settling at the merchant floor. Audit residual 2026-05-05. */
  swap_amount_out: string | null;
  settle_tx_hash:  string | null;
  refund_tx_hash:  string | null;
  /** Audit 2026-05-24 H-2: surfaced for resumeRefund so the re-issued
   *  recordPayerRefund can preserve the original swap-failure reason
   *  instead of stamping "resumed" as the only on-chain trail. */
  last_error:      string | null;
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
                       amount_out_min, permit2_data, permit2_signature, attempts,
                       permit2_tx_hash, swap_tx_hash, swap_amount_out,
                       settle_tx_hash, refund_tx_hash, last_error
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

// Stage-aware persistors — write each tx hash as soon as the chain receipt
// returns so a daemon crash mid-flight is recoverable. Audit P1 #3.
async function persistPermit2Tx(id: string, tx: Hex): Promise<void> {
  await pool.query(
    `update relayer_queue set permit2_tx_hash = $2, updated_at = now() where id = $1`,
    [id, tx],
  );
}

async function persistSwapTx(id: string, tx: Hex, amountOutBaseUnits: bigint): Promise<void> {
  await pool.query(
    `update relayer_queue
        set swap_tx_hash = $2, swap_amount_out = $3, updated_at = now()
      where id = $1`,
    [id, tx, amountOutBaseUnits.toString()],
  );
}

async function persistSettleTx(id: string, tx: Hex): Promise<void> {
  await pool.query(
    `update relayer_queue set settle_tx_hash = $2, updated_at = now() where id = $1`,
    [id, tx],
  );
}

// Audit 2026-05-24 H-2: mirror the settle/permit2 persist-before-await
// pattern on the refund path. The customer-facing ERC-20 transfer goes out
// before the gateway's recordPayerRefund call — if the daemon crashed
// between transfer broadcast and the receipt wait, the tx hash was lost,
// the reclaim re-entered refundPayer, the balance check failed (funds
// already gone), and the customer ended up paid on-chain while the DB
// row said `failed` and the gateway never saw recordPayerRefund. We now
// persist refund_tx_hash the moment writeContract returns and resume
// from this checkpoint via resumeRefund() instead of restarting the
// refund flow.
async function persistRefundTx(id: string, tx: Hex): Promise<void> {
  await pool.query(
    `update relayer_queue set refund_tx_hash = $2, updated_at = now() where id = $1`,
    [id, tx],
  );
}

async function markSettled(id: string, swapTx: Hex, settleTx: Hex): Promise<void> {
  // Same-token rows never wrote swap_tx_hash; backfill it here for
  // observability. swap_tx_hash on cross-token rows was already persisted
  // by persistSwapTx; coalesce to keep that value if non-null.
  await pool.query(
    `update relayer_queue
        set status = 'settled',
            swap_tx_hash   = coalesce(swap_tx_hash, $2),
            settle_tx_hash = $3,
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

async function pullViaPermit2(
  row: QueueRow,
  onBroadcast: (tx: Hex) => Promise<void>,
): Promise<Hex> {
  // Permit2 permitWitnessTransferFrom: pulls amountIn of payInToken from
  // payer → relayer wallet, atomically validating the customer's signature
  // and the witness binding.
  //
  // Audit residual P2 (2026-05-05): persist permit2_tx_hash via
  // onBroadcast() the moment writeContract returns, before awaiting the
  // receipt — same pattern as callSettle. A daemon crash in the
  // receipt-await window used to lose the hash; reclaim then re-issued
  // permitWitnessTransferFrom against an already-spent nonce → InvalidNonce
  // → markFailed/manual-reconciliation, with the customer's payIn already
  // in the relayer wallet.
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
  await onBroadcast(tx);
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
  onBroadcast: (tx: Hex) => Promise<void>,
): Promise<Hex> {
  // The relayer holds payoutToken in its hot wallet now. Approve the gateway
  // to pull `grossPayoutBaseUnits`, then call settleInvoice.
  //
  // Audit residual P2 (2026-05-05): persist the settle tx hash via
  // onBroadcast() the moment writeContract returns, before awaiting the
  // receipt. Crashing during the receipt-await window used to lose the
  // hash; reclaim would then re-call settleInvoice → V9 reverts as already
  // paid → markFailed even though the on-chain payment landed. Approve
  // doesn't get the same treatment because it's idempotent (raises
  // allowance to the same value); resuming can re-issue it safely.
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
  await onBroadcast(tx);
  await chain.waitForTransactionReceipt({ hash: tx });
  return tx;
}

/** Build the bytes32 reasonHash field from a free-text reason string.
 *  Audit #34: slice the encoded byte array, not the character string —
 *  multi-byte UTF-8 chars would otherwise overflow bytes32. */
function reasonToHash(reason: string): Hex {
  const reasonBytes = new TextEncoder().encode(reason).slice(0, 32);
  return ("0x" +
    Array.from(reasonBytes)
      .map(b => b.toString(16).padStart(2, "0")).join("")
      .padEnd(64, "0")
  ) as Hex;
}

async function refundPayer(
  row: QueueRow,
  reason: string,
  onTransferBroadcast: (tx: Hex) => Promise<void>,
): Promise<Hex> {
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

  // Audit 2026-05-24 H-2: persist refund_tx_hash the moment writeContract
  // returns and BEFORE waiting for the receipt, mirroring the settle and
  // permit2 paths. A crash inside the receipt-await window used to leave
  // the customer paid on-chain while the DB row said `failed` and the
  // gateway never saw recordPayerRefund. resumeRefund() picks up from
  // this checkpoint on lease reclaim.
  const transferTx = await wallet.writeContract({
    chain: undefined,
    address: row.pay_in_token as Address,
    abi: ERC20,
    functionName: "transfer",
    args: [row.payer as Address, owedBack],
  });
  await onTransferBroadcast(transferTx);
  await chain.waitForTransactionReceipt({ hash: transferTx });

  // Tell the gateway: the indexer flips the invoice to `failed` from this event.
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
      reasonToHash(reason),
    ],
  });
  await chain.waitForTransactionReceipt({ hash: recordTx });
  return transferTx;
}

/** Audit 2026-05-24 H-2: resume a refund flow that crashed after the
 *  customer-facing transfer was broadcast. refund_tx_hash being set means
 *  the transfer reached the network; verify it landed, then call
 *  recordPayerRefund (the contract's `inv.status == Created` guard makes
 *  it idempotent — InvoiceNotInCreatedState revert => already recorded). */
async function resumeRefund(row: QueueRow): Promise<{ ok: true; tx: Hex } | { ok: false; err: string }> {
  const transferTx = row.refund_tx_hash as Hex;

  let rcpt;
  try {
    rcpt = await chain.waitForTransactionReceipt({ hash: transferTx, timeout: 30_000 });
  } catch (e) {
    // Receipt not yet available — leave row in processing for next reclaim.
    // Don't escalate to failed unless we hit MAX_ATTEMPTS so a stuck refund
    // tx eventually surfaces for operator triage.
    if (row.attempts >= MAX_ATTEMPTS) {
      return { ok: false, err:
        `refund transfer ${transferTx} stuck unconfirmed after ${row.attempts} attempts — manual reconciliation needed`,
      };
    }
    throw e;  // let processOne's outer catch log + reschedule
  }

  if (rcpt.status !== "success") {
    return { ok: false, err: `refund transfer ${transferTx} reverted — manual reconciliation needed` };
  }

  // Transfer landed. Re-issue recordPayerRefund; revert with
  // InvoiceNotInCreatedState means it already ran on the previous attempt
  // and we can mark the row done.
  try {
    const recordTx = await wallet.writeContract({
      chain: undefined,
      address: gatewayFor(row),
      abi: GATEWAY_ABI,
      functionName: "recordPayerRefund",
      args: [
        row.invoice_id as Hex,
        row.payer as Address,
        row.pay_in_token as Address,
        BigInt(row.amount_in),
        reasonToHash(row.last_error ?? "resumed"),
      ],
    });
    await chain.waitForTransactionReceipt({ hash: recordTx });
    return { ok: true, tx: transferTx };
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    if (/InvoiceNotInCreatedState/i.test(err)) {
      // Gateway already saw recordPayerRefund on a prior attempt; safe to close.
      return { ok: true, tx: transferTx };
    }
    return { ok: false, err: `refund record on resume: ${err}` };
  }
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

const ZERO_HASH = "0x0000000000000000000000000000000000000000000000000000000000000000" as Hex;

/** Heuristic: did Permit2 revert because the nonce was already consumed?
 *  Permit2's `_useUnorderedNonce` reverts with `InvalidNonce()` (selector
 *  0x756688fe) when the bit is already flipped. viem surfaces both the name
 *  and the hex selector in the error message depending on whether ABI
 *  decoding succeeded — match either. */
function isPermit2NonceUsed(err: string): boolean {
  return /InvalidNonce/i.test(err) || /0x756688fe/i.test(err);
}

async function processOne(row: QueueRow): Promise<void> {
  const log = (level: string, fields: Record<string, unknown>) => {
    console.log(JSON.stringify({
      ts: new Date().toISOString(), level, queueId: row.id,
      invoiceId: row.invoice_id, attempt: row.attempts, ...fields,
    }));
  };

  log("info", {
    msg: "row.claimed",
    resume: {
      permit2: !!row.permit2_tx_hash,
      swap:    !!row.swap_tx_hash,
      settle:  !!row.settle_tx_hash,
      refund:  !!row.refund_tx_hash,
    },
  });

  // Audit 2026-05-24 H-2: refund resume short-circuits everything else.
  // refund_tx_hash being set means the prior attempt already broadcast the
  // customer-facing transfer and we crashed inside the receipt-await
  // window or before recordPayerRefund. Don't re-enter the swap/settle
  // flow — finish reconciling this refund and exit.
  if (row.refund_tx_hash) {
    log("info", { msg: "refund.resume", tx: row.refund_tx_hash });
    const res = await resumeRefund(row);
    if (res.ok) {
      await markRefunded(row.id, res.tx, "resumed after mid-flight crash");
      log("info", { msg: "refund.resume.ok", tx: res.tx });
    } else {
      await markFailed(row.id, res.err);
      log("error", { msg: "refund.resume.fail", err: res.err });
    }
    return;
  }

  // Step 1: pull pay-in via Permit2 (skip if a previous attempt already
  // pulled — Permit2 nonce is consumed on-chain, retrying would revert).
  if (!row.permit2_tx_hash) {
    try {
      const pullTx = await pullViaPermit2(row, async (tx) => {
        await persistPermit2Tx(row.id, tx);
        row.permit2_tx_hash = tx;
      });
      log("info", { msg: "permit2.ok", tx: pullTx });
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      log("error", { msg: "permit2.fail", err, attempts: row.attempts });
      // If a previous attempt actually pulled the funds but we crashed
      // before persisting permit2_tx_hash, the next attempt will hit
      // InvalidNonce. The customer's payIn is sitting in the relayer wallet;
      // operator needs to reconcile rather than letting us silently retry
      // forever. Surface as failed so it shows up in the ops dashboard.
      if (isPermit2NonceUsed(err) && row.attempts > 1) {
        await markFailed(
          row.id,
          `permit2 nonce already used on retry — pay-in likely in relayer wallet, ` +
          `manual reconciliation needed: ${err}`,
        );
        return;
      }
      await reschedule(row.id, `permit2: ${err}`, row.attempts);
      return;
    }
  } else {
    log("info", { msg: "permit2.skip", reason: "already-pulled", tx: row.permit2_tx_hash });
  }

  // Step 2: swap (skipped when payIn == payout — App Kit refuses identical
  // legs with "Swap from USDC to USDC ... not supported" and the customer
  // ends up refunded for a payment that should have settled directly).
  const sameToken = row.pay_in_token.toLowerCase() === row.payout_token.toLowerCase();
  let grossPayout: bigint;
  let swapTxHash:  Hex;

  if (sameToken) {
    grossPayout = BigInt(row.amount_in);
    swapTxHash  = ZERO_HASH;
    log("info", { msg: "swap.skip", reason: "same-token", grossPayout: grossPayout.toString() });
  } else if (row.swap_tx_hash) {
    // Resumed after swap — kit.swap was called and persisted. Audit
    // residual P2 (2026-05-05): the prior approach defaulted grossPayout
    // to amount_out_min when resuming, which left swap surplus stranded
    // in the relayer wallet (no protocolFeesAccrued credit). Now we use
    // the persisted swap_amount_out for an exact resume; legacy rows
    // written before the column landed fall back to the conservative
    // floor (one-time during the migration window).
    swapTxHash  = row.swap_tx_hash as Hex;
    grossPayout = row.swap_amount_out
      ? BigInt(row.swap_amount_out)
      : BigInt(row.amount_out_min);
    log("info", {
      msg: "swap.skip", reason: "already-swapped",
      tx: swapTxHash,
      grossPayout: grossPayout.toString(),
      source: row.swap_amount_out ? "persisted" : "legacy-floor",
    });
  } else {
    try {
      const swap = await runSwap(row);
      grossPayout = parseHumanAmount(swap.amountOut, 6);
      swapTxHash  = swap.txHash;
      await persistSwapTx(row.id, swap.txHash, grossPayout);
      row.swap_tx_hash    = swap.txHash;
      row.swap_amount_out = grossPayout.toString();
      log("info", { msg: "swap.ok", tx: swap.txHash, amountOut: swap.amountOut });
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      log("error", { msg: "swap.fail", err });
      try {
        const refundTx = await refundPayer(row, err, async (tx) => {
          await persistRefundTx(row.id, tx);
          row.refund_tx_hash = tx;
        });
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

  // Step 3: settle. If settle_tx_hash is already set, the previous attempt
  // broadcast settleInvoice — query the receipt to learn the outcome:
  //   success → the merchant was paid, just markSettled and bail.
  //   reverted → don't re-broadcast (would revert again as InvoicePayment
  //              already exists or as some other terminal state); markFailed
  //              for operator review.
  //   pending/missing → wait briefly and recurse the same logic; failing
  //              that, leave the row in `processing` for the next lease
  //              reclaim to retry.
  if (row.settle_tx_hash) {
    try {
      const rcpt = await chain.waitForTransactionReceipt({
        hash: row.settle_tx_hash as Hex,
        timeout: 30_000,
      });
      if (rcpt.status === "success") {
        await markSettled(row.id, swapTxHash, row.settle_tx_hash as Hex);
        log("info", { msg: "settle.skip", reason: "already-broadcast-success", tx: row.settle_tx_hash });
        return;
      }
      await markFailed(row.id, `settle: prior tx ${row.settle_tx_hash} reverted, manual reconciliation needed`);
      log("error", { msg: "settle.prior_reverted", tx: row.settle_tx_hash });
      return;
    } catch (e) {
      // Receipt unavailable — likely still pending or RPC timeout. Don't
      // re-broadcast (would race the pending tx); leave the row in
      // processing and let the next lease reclaim retry.
      //
      // Audit #18: if a tx sits stuck in the mempool indefinitely (gas too
      // low, network congestion, dropped from peer pools), repeated lease
      // reclaims would otherwise spin forever without ever surfacing the
      // problem. `attempts` is incremented on every claim, so once it
      // crosses MAX_ATTEMPTS we mark the row failed for operator triage.
      // Manual reconciliation: the tx might still land on-chain, in which
      // case the operator replays settleInvoice externally or rebroadcasts
      // with higher gas.
      if (row.attempts >= MAX_ATTEMPTS) {
        await markFailed(
          row.id,
          `settle: prior tx ${row.settle_tx_hash} stuck unconfirmed after ${row.attempts} attempts — manual reconciliation needed`,
        );
        log("error", {
          msg: "settle.stuck_unconfirmed_max_attempts",
          tx: row.settle_tx_hash,
          attempts: row.attempts,
        });
        return;
      }
      log("warn", {
        msg: "settle.receipt_unavailable",
        tx: row.settle_tx_hash,
        attempts: row.attempts,
        err: e instanceof Error ? e.message : String(e),
      });
      return;
    }
  }

  try {
    if (grossPayout < BigInt(row.amount_out_min)) {
      throw new Error(`gross ${grossPayout} below floor ${row.amount_out_min}`);
    }
    const settleTx = await callSettle(
      row, grossPayout, swapTxHash,
      async (tx) => { await persistSettleTx(row.id, tx); },
    );
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
