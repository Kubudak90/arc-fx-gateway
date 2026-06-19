/**
 * v2 no-custody keeper (PLAN integration Phase 3). Replaces the v1 custody
 * cross-chain worker (mint-to-relayer → swap → settleInvoice). This keeper NEVER
 * holds user funds — it only:
 *   DEPOSITED        → after the refund window, PaymentEscrow.settle()
 *                        Path A  → SETTLED (merchant paid on the escrow chain)
 *                        Path B/C → CCTP burn → BURN_SENT (burnTx recorded)
 *   BURN_SENT        → poll Iris; when attested, SettlementReceiver.receiveAndSettle()
 *                        Path B  → SETTLED, or PAYOUT_FAILED (blacklisted merchant)
 *                        Path C  → RECEIVE_SENT (USDC parked, pending swap)
 *   PAYOUT_FAILED    → recoverToBuyer() → RECOVERED_TO_BUYER (USDC back to buyer)
 *   RECEIVE_SENT (C) → SettlementReceiver.settle() USDC fallback → SETTLED_FALLBACK_USDC
 *
 * The `settlements` table IS the durable Store; every transition is persisted, so
 * the loop is crash-safe and resumable. Reads/writes use raw SQL (pg), matching
 * the rest of ops/relayer.
 */
import {
  createPublicClient, createWalletClient, defineChain, http,
  type Account, type Address, type Hex, type PublicClient, type WalletClient,
} from "viem";
import type { Pool } from "pg";
import {
  getTestnets, getChainByDomain, paymentEscrowAbi, settlementReceiverAbi, getMessages,
  CCTP_FINALITY, type ChainConfig,
} from "@arcora/router";

interface ChainClient {
  cfg: ChainConfig;
  pub: PublicClient;
  wallet: WalletClient;
  refundWindow?: bigint; // cached PaymentEscrow.REFUND_WINDOW
}

export interface V2KeeperDeps {
  pool: Pool;
  account: Account;
  /** Override RPC per chain (else registry defaultRpcUrl). */
  rpcFor?: (c: ChainConfig) => string | undefined;
  now?: () => number;
  log?: (msg: string) => void;
}

export function buildChainClients(account: Account, rpcFor?: (c: ChainConfig) => string | undefined): Map<number, ChainClient> {
  const map = new Map<number, ChainClient>();
  for (const cfg of getTestnets()) {
    if (!cfg.contracts.paymentEscrow || !cfg.contracts.settlementReceiver) continue;
    const rpc = rpcFor?.(cfg) ?? cfg.defaultRpcUrl;
    if (!rpc) continue;
    const chain = defineChain({
      id: cfg.chainId, name: cfg.name,
      nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [rpc] } },
    });
    map.set(cfg.cctpDomain, {
      cfg,
      pub: createPublicClient({ chain, transport: http(rpc) }),
      wallet: createWalletClient({ account, chain, transport: http(rpc) }),
    });
  }
  return map;
}

interface Row {
  invoice_ref: Hex;
  escrow_id: Hex | null;
  path: "A" | "B" | "C" | null;
  escrow_domain: number | null;
  payout_domain: number;
  state: string;
  burn_tx: Hex | null;
}

const ACTIONABLE = ["DEPOSITED", "BURN_SENT", "PAYOUT_FAILED", "RECEIVE_SENT"];

export async function processSettlementsOnce(deps: V2KeeperDeps): Promise<void> {
  const clients = buildChainClients(deps.account, deps.rpcFor);
  const log = deps.log ?? (() => {});
  const { rows } = await deps.pool.query<Row>(
    `SELECT invoice_ref, escrow_id, path, escrow_domain, payout_domain, state, burn_tx
       FROM settlements WHERE state = ANY($1) AND escrow_id IS NOT NULL`,
    [ACTIONABLE],
  );
  for (const r of rows) {
    try {
      await processRow(r, clients, deps, log);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log(`v2-keeper ${r.invoice_ref} (${r.state}): ${msg}`);
      await deps.pool.query(`UPDATE settlements SET last_error=$2, updated_at=now() WHERE invoice_ref=$1`, [r.invoice_ref, msg]);
    }
  }
}

async function setState(deps: V2KeeperDeps, ref: Hex, state: string, extra: Record<string, unknown> = {}): Promise<void> {
  const cols = Object.keys(extra);
  const sets = ["state=$2", "updated_at=now()", ...cols.map((c, i) => `${c}=$${i + 3}`)].join(", ");
  await deps.pool.query(`UPDATE settlements SET ${sets} WHERE invoice_ref=$1`, [ref, state, ...cols.map((c) => extra[c])]);
}

async function processRow(r: Row, clients: Map<number, ChainClient>, deps: V2KeeperDeps, log: (m: string) => void): Promise<void> {
  const escrowId = r.escrow_id!;
  const src = r.escrow_domain != null ? clients.get(r.escrow_domain) : undefined;
  const dest = clients.get(r.payout_domain);

  if (r.state === "DEPOSITED") {
    if (!src) return;
    // Only settle once the refund window has closed.
    if (src.refundWindow == null) {
      src.refundWindow = (await src.pub.readContract({ address: src.cfg.contracts.paymentEscrow as Address, abi: paymentEscrowAbi, functionName: "REFUND_WINDOW" })) as bigint;
    }
    const e = (await src.pub.readContract({ address: src.cfg.contracts.paymentEscrow as Address, abi: paymentEscrowAbi, functionName: "escrows", args: [escrowId] })) as readonly [Address, Address, bigint, bigint, number, number, number];
    const createdAt = e[3];
    const status = e[6];
    if (status !== 1) return; // not Escrowed (already settled/refunded elsewhere)
    const nowSec = BigInt(Math.floor((deps.now?.() ?? Date.now()) / 1000));
    if (nowSec <= createdAt + src.refundWindow) return; // still in window

    const sameChain = r.payout_domain === r.escrow_domain;
    const threshold = CCTP_FINALITY.STANDARD; // 2000 — supported on every chain
    const tx = await src.wallet.writeContract({
      address: src.cfg.contracts.paymentEscrow as Address, abi: paymentEscrowAbi, functionName: "settle",
      args: [escrowId, { minOut: 0n, maxFee: 0n, minFinalityThreshold: threshold, swapCalldata: "0x" }],
      account: deps.account, chain: null,
    } as never);
    await src.pub.waitForTransactionReceipt({ hash: tx });
    if (sameChain) {
      await setState(deps, r.invoice_ref, "SETTLED", { settle_tx: tx, path: "A" });
      log(`v2-keeper ${r.invoice_ref}: Path A settled ${tx}`);
    } else {
      await setState(deps, r.invoice_ref, "BURN_SENT", { burn_tx: tx, settle_tx: tx });
      log(`v2-keeper ${r.invoice_ref}: burned for cross-chain ${tx}`);
    }
    return;
  }

  if (r.state === "BURN_SENT") {
    if (!dest || !src || !r.burn_tx) return;
    const msgs = await getMessages(r.escrow_domain!, r.burn_tx, { testnet: true });
    const m = msgs[0];
    if (!m || m.status !== "complete" || m.attestation === "PENDING") return; // not attested yet
    const rcv = dest.cfg.contracts.settlementReceiver as Address;
    const tx = await dest.wallet.writeContract({
      address: rcv, abi: settlementReceiverAbi, functionName: "receiveAndSettle", args: [m.message, m.attestation],
      account: deps.account, chain: null,
    } as never);
    await dest.pub.waitForTransactionReceipt({ hash: tx });
    // Determine outcome on the dest side.
    const failed = (await dest.pub.readContract({ address: rcv, abi: settlementReceiverAbi, functionName: "failedPayout", args: [escrowId] })) as readonly [Address, bigint];
    if (failed[1] > 0n) {
      await setState(deps, r.invoice_ref, "PAYOUT_FAILED", { receive_tx: tx, cctp_attestation: m.attestation });
      log(`v2-keeper ${r.invoice_ref}: payout parked (blacklist?) ${tx}`);
      return;
    }
    const pending = (await dest.pub.readContract({ address: rcv, abi: settlementReceiverAbi, functionName: "pending", args: [escrowId] })) as readonly [Address, number, bigint, bigint];
    if (pending[2] > 0n) {
      await setState(deps, r.invoice_ref, "RECEIVE_SENT", { receive_tx: tx, cctp_attestation: m.attestation });
      log(`v2-keeper ${r.invoice_ref}: Path C pending swap ${tx}`);
    } else {
      await setState(deps, r.invoice_ref, "SETTLED", { receive_tx: tx, cctp_attestation: m.attestation });
      log(`v2-keeper ${r.invoice_ref}: Path B settled ${tx}`);
    }
    return;
  }

  if (r.state === "PAYOUT_FAILED") {
    if (!dest) return;
    const rcv = dest.cfg.contracts.settlementReceiver as Address;
    const tx = await dest.wallet.writeContract({
      address: rcv, abi: settlementReceiverAbi, functionName: "recoverToBuyer",
      args: [escrowId, 0n, CCTP_FINALITY.STANDARD], account: deps.account, chain: null,
    } as never);
    await dest.pub.waitForTransactionReceipt({ hash: tx });
    await setState(deps, r.invoice_ref, "RECOVERED_TO_BUYER", { recover_tx: tx });
    await deps.pool.query(`UPDATE invoices SET status='refunded', refund_tx=$2, refunded_at=now() WHERE id=$1`, [r.invoice_ref, tx]);
    log(`v2-keeper ${r.invoice_ref}: recovered to buyer ${tx}`);
    return;
  }

  if (r.state === "RECEIVE_SENT") {
    // Path C: no on-testnet Li.Fi route → USDC fallback (empty swap calldata).
    if (!dest) return;
    const rcv = dest.cfg.contracts.settlementReceiver as Address;
    const tx = await dest.wallet.writeContract({
      address: rcv, abi: settlementReceiverAbi, functionName: "settle",
      args: [escrowId, "0x", 0n], account: deps.account, chain: null,
    } as never);
    await dest.pub.waitForTransactionReceipt({ hash: tx });
    await setState(deps, r.invoice_ref, "SETTLED_FALLBACK_USDC", { settle_tx: tx });
    log(`v2-keeper ${r.invoice_ref}: Path C USDC fallback ${tx}`);
    return;
  }
}

/** Long-running loop. Call from run.ts (flag-gated) alongside the v1 drain. */
export function startV2Keeper(deps: V2KeeperDeps, tickMs = 8000): () => void {
  let stopped = false;
  const tick = async () => {
    if (stopped) return;
    try { await processSettlementsOnce(deps); } catch (e) { (deps.log ?? console.error)(`v2-keeper tick error: ${e}`); }
    if (!stopped) setTimeout(tick, tickMs);
  };
  setTimeout(tick, tickMs);
  return () => { stopped = true; };
}
