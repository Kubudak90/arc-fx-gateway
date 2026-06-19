/**
 * v2 reconciliation indexer (PLAN integration Phase 4). Polls PaymentEscrow +
 * SettlementReceiver events on every deployed v2 chain and reconciles the
 * `settlements` / `invoices` tables from on-chain truth. This is the ROBUSTNESS
 * backstop for the no-custody flow:
 *   - Deposited        → if the buyer's browser POST to /api/checkout/v2/deposit
 *                        was lost, the deposit is still recorded here.
 *   - Refunded (escrow)→ a buyer who refunds directly is reflected.
 *   - Settled / PayoutFailed / RecoveredToBuyer / SettledFallbackUSDC → terminal
 *                        settlement state confirmed from events (backstop for the
 *                        keeper's optimistic updates).
 * Forward-only: on first run per chain the cursor starts at the current block.
 */
import {
  createPublicClient, http, defineChain, parseAbiItem,
  type Address, type Hex, type PublicClient,
} from "viem";
import type { Pool } from "pg";
import { getTestnets, selectRoute, type ChainConfig, type PayoutToken } from "@arcora/router";

const MAX_RANGE = 9_000n;
const TOKEN_BY_INDEX: PayoutToken[] = ["USDC", "EURC", "USDT"];

// Event signatures must match the contracts verbatim.
const Deposited = parseAbiItem(
  "event Deposited(bytes32 indexed escrowId, bytes32 indexed invoiceRef, address indexed payer, address merchant, uint256 amount, uint32 payoutDomain, uint8 payoutToken)",
);
const EscrowRefunded = parseAbiItem("event Refunded(bytes32 indexed escrowId, address indexed payer, uint256 amount)");
const EscrowSettled = parseAbiItem("event Settled(bytes32 indexed escrowId, address indexed merchant, address token, uint256 amount)");
const RcvSettled = EscrowSettled; // same signature on SettlementReceiver
const PayoutFailed = parseAbiItem("event PayoutFailed(bytes32 indexed escrowId, address indexed payer, uint256 amount)");
const RecoveredToBuyer = parseAbiItem("event RecoveredToBuyer(bytes32 indexed escrowId, address indexed payer, uint32 sourceDomain, uint256 amount)");
const SettledFallbackUSDC = parseAbiItem("event SettledFallbackUSDC(bytes32 indexed escrowId, address indexed merchant, uint256 amount)");

export interface V2IndexerDeps {
  pool: Pool;
  rpcFor?: (c: ChainConfig) => string | undefined;
  log?: (msg: string) => void;
}

function clients(rpcFor?: (c: ChainConfig) => string | undefined): { cfg: ChainConfig; pub: PublicClient }[] {
  const out: { cfg: ChainConfig; pub: PublicClient }[] = [];
  for (const cfg of getTestnets()) {
    if (!cfg.contracts.paymentEscrow || !cfg.contracts.settlementReceiver) continue;
    const rpc = rpcFor?.(cfg) ?? cfg.defaultRpcUrl;
    if (!rpc) continue;
    const chain = defineChain({
      id: cfg.chainId, name: cfg.name,
      nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [rpc] } },
    });
    out.push({ cfg, pub: createPublicClient({ chain, transport: http(rpc) }) });
  }
  return out;
}

async function getCursor(pool: Pool, chainId: number, current: bigint): Promise<bigint> {
  const r = await pool.query<{ value: string }>("select value from indexer_state where key=$1", [`v2_cursor_${chainId}`]);
  if (r.rows[0]) return BigInt(r.rows[0].value);
  await setCursor(pool, chainId, current);
  return current;
}
async function setCursor(pool: Pool, chainId: number, block: bigint): Promise<void> {
  await pool.query(
    `insert into indexer_state(key, value, updated_at) values($1,$2,now())
       on conflict(key) do update set value=excluded.value, updated_at=now()`,
    [`v2_cursor_${chainId}`, block.toString()],
  );
}

/** Advance a settlement to a terminal-ish state by escrowId, never regressing. */
async function reconcile(pool: Pool, escrowId: Hex, state: string, refundInvoice = false): Promise<void> {
  await pool.query(
    `update settlements set state=$2, updated_at=now()
       where escrow_id=$1 and state not in ('SETTLED','SETTLED_FALLBACK_USDC','RECOVERED_TO_BUYER','REFUNDED')`,
    [escrowId, state],
  );
  if (refundInvoice) {
    await pool.query(
      `update invoices set status='refunded', refunded_at=now() where escrow_id=$1 and status <> 'refunded'`,
      [escrowId],
    );
  }
}

export async function indexV2Once(deps: V2IndexerDeps): Promise<void> {
  const log = deps.log ?? (() => {});
  for (const { cfg, pub } of clients(deps.rpcFor)) {
    const escrow = cfg.contracts.paymentEscrow as Address;
    const receiver = cfg.contracts.settlementReceiver as Address;
    const current = await pub.getBlockNumber();
    let cursor = await getCursor(deps.pool, cfg.chainId, current);
    if (cursor > current) cursor = current;
    if (cursor >= current) continue;
    const end = cursor + MAX_RANGE > current ? current : cursor + MAX_RANGE;
    const range = { fromBlock: cursor + 1n, toBlock: end } as const;

    const [deps_, refunds, escSettled, rcvSettled, failed, recovered, fallback] = await Promise.all([
      pub.getLogs({ address: escrow, event: Deposited, ...range }),
      pub.getLogs({ address: escrow, event: EscrowRefunded, ...range }),
      pub.getLogs({ address: escrow, event: EscrowSettled, ...range }),
      pub.getLogs({ address: receiver, event: RcvSettled, ...range }),
      pub.getLogs({ address: receiver, event: PayoutFailed, ...range }),
      pub.getLogs({ address: receiver, event: RecoveredToBuyer, ...range }),
      pub.getLogs({ address: receiver, event: SettledFallbackUSDC, ...range }),
    ]);

    // Deposited backstop — match by invoiceRef; only fill a settlement that has
    // no escrowId yet (i.e. the browser POST never landed).
    for (const l of deps_) {
      const a = l.args;
      const tokenSym = TOKEN_BY_INDEX[Number(a.payoutToken)] ?? "USDC";
      const path = selectRoute({ escrowDomain: cfg.cctpDomain, payoutDomain: Number(a.payoutDomain), payoutToken: tokenSym as PayoutToken });
      const res = await deps.pool.query(
        `update settlements set escrow_id=$2, escrow_chain_id=$3, escrow_domain=$4, path=$5,
           state='DEPOSITED', deposit_tx=$6, payer=$7, updated_at=now()
           where invoice_ref=$1 and escrow_id is null`,
        [a.invoiceRef, a.escrowId, cfg.chainId, cfg.cctpDomain, path, l.transactionHash, a.payer],
      );
      if ((res.rowCount ?? 0) > 0) {
        await deps.pool.query(
          `update invoices set escrow_id=$2, status='paid', paid_by=$3, paid_tx=$4, paid_at=now()
             where id=$1 and status='created'`,
          [a.invoiceRef, a.escrowId, a.payer, l.transactionHash],
        );
        log(`v2-indexer backstop deposit ${a.invoiceRef} on ${cfg.key}`);
      }
    }

    for (const l of refunds) await reconcile(deps.pool, l.args.escrowId as Hex, "REFUNDED", true);
    for (const l of escSettled) await reconcile(deps.pool, l.args.escrowId as Hex, "SETTLED");
    for (const l of rcvSettled) await reconcile(deps.pool, l.args.escrowId as Hex, "SETTLED");
    for (const l of failed) await reconcile(deps.pool, l.args.escrowId as Hex, "PAYOUT_FAILED");
    for (const l of recovered) await reconcile(deps.pool, l.args.escrowId as Hex, "RECOVERED_TO_BUYER", true);
    for (const l of fallback) await reconcile(deps.pool, l.args.escrowId as Hex, "SETTLED_FALLBACK_USDC");

    await setCursor(deps.pool, cfg.chainId, end);
  }
}

export function startV2Indexer(deps: V2IndexerDeps, tickMs = 30000): () => void {
  let stopped = false;
  const tick = async () => {
    if (stopped) return;
    try { await indexV2Once(deps); } catch (e) { (deps.log ?? console.error)(`v2-indexer tick error: ${e}`); }
    if (!stopped) setTimeout(tick, tickMs);
  };
  setTimeout(tick, tickMs);
  return () => { stopped = true; };
}
