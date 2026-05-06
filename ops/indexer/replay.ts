/**
 * Standalone recovery tool for the arcora-indexer daemon. Two modes:
 *
 *   pnpm tsx replay.ts reset  --to-block <N>
 *     Sets indexer_state.last_processed_block = N. The running daemon picks
 *     this up on its next tick and starts walking from N+1 forward. Use this
 *     when you need to re-process a range that the daemon already passed
 *     (e.g. a DB restore from yesterday + a bug fix that needs the events
 *     re-applied).
 *
 *   pnpm tsx replay.ts replay --from <A> --to <B> [--dry-run]
 *     Walks blocks [A, B] in 9k-block chunks, writes any missing paid /
 *     refunded / claimed / recovered rows, and DOES NOT touch indexer_state.
 *     Use this when you want a one-off catch-up without disturbing the
 *     daemon's cursor.
 *
 * The script shares the daemon's RPC + DB env (.env at the same path) and
 * uses the same chunk size + ABI to stay byte-identical with run.ts.
 *
 * Run from /root/arcora-ops/indexer/ on the VPS, or locally after
 * `cd ops/indexer && pnpm install`.
 */

import {
  createPublicClient, http, decodeEventLog, parseAbi,
  type Address, type Hex,
} from "viem";
import pg from "pg";
import { randomUUID } from "node:crypto";

const RPC         = need("ARC_TESTNET_RPC");
const GATEWAY_V10 = (process.env.GATEWAY_ADDRESS_V10 ?? "").toLowerCase() as Address;
if (!GATEWAY_V10) throw new Error("GATEWAY_ADDRESS_V10 must be set");
const PG_URL      = need("POSTGRES_URL_NON_POOLING");
const MAX_RANGE   = 9_000n;

function need(k: string): string {
  const v = process.env[k];
  if (!v) throw new Error(`missing env ${k}`);
  return v;
}

const ABI = parseAbi([
  "event InvoiceCreated(bytes32 indexed globalId, address indexed merchant, bytes32 indexed merchantInvoiceId, address payIn, address payoutToken, uint256 amountOut, uint64 expiresAt)",
  "event InvoicePaid(bytes32 indexed globalId, address indexed payer, uint256 amountIn, uint256 grossReceived, uint256 merchantPayout, uint256 fee)",
  "event SettlementContext(bytes32 indexed globalId, address indexed payInToken, bytes32 swapTxHash)",
  "event EscrowCreated(bytes32 indexed globalId, address indexed payoutToken, uint256 amount, uint64 claimableAt)",
  "event PayerRefunded(bytes32 indexed globalId, address indexed payer, address payInToken, uint256 amount, bytes32 reasonHash)",
  "event InvoiceRefunded(bytes32 indexed globalId, address indexed refundedTo, address indexed payoutToken, uint256 merchantPayout, uint256 protocolFeeReturned)",
  "event InvoiceClaimed(bytes32 indexed globalId, address indexed merchant, address payoutAddress, address payoutToken, uint256 toMerchant, uint256 fee)",
  "event EscrowRecovered(bytes32 indexed globalId, address indexed merchant, address payoutToken, uint256 amount, address to)",
  "event MerchantReactivated(address indexed merchant)",
]);
const InvoicePaid         = ABI[1];
const EscrowCreated       = ABI[3];
const InvoiceRefunded     = ABI[5];
const InvoiceClaimed      = ABI[6];
const EscrowRecovered     = ABI[7];
const MerchantReactivated = ABI[8];

const chain = createPublicClient({ transport: http(RPC) });
const pool  = new pg.Pool({ connectionString: PG_URL, ssl: { rejectUnauthorized: false } });

async function enqueueWebhook(
  invoiceId: string,
  merchantId: string,
  eventType: string,
  extra: Record<string, unknown>,
  txHash: string | null,
): Promise<void> {
  const mr = await pool.query<{ webhook_url: string | null }>(
    "select webhook_url from merchants where id = $1", [merchantId],
  );
  const url = mr.rows[0]?.webhook_url;
  if (!url) return;
  await pool.query(
    `insert into webhook_attempts(invoice_id, url, payload, attempts, next_attempt, event_type)
     values ($1, $2, $3::jsonb, 0, now(), $4)
     on conflict (invoice_id, event_type) do nothing`,
    [
      invoiceId, url,
      JSON.stringify({ event_id: randomUUID(), type: eventType, invoice_id: invoiceId, tx_hash: txHash, replay: true, ...extra }),
      eventType,
    ],
  );
}

interface ReplayCounts {
  scannedChunks:    number;
  paidUpdated:      number;
  refundedUpdated:  number;
  claimedUpdated:   number;
  recoveredUpdated: number;
  webhooksQueued:   number;
}

async function replay(from: bigint, to: bigint, dryRun: boolean): Promise<ReplayCounts> {
  const counts: ReplayCounts = {
    scannedChunks: 0, paidUpdated: 0, refundedUpdated: 0,
    claimedUpdated: 0, recoveredUpdated: 0, webhooksQueued: 0,
  };
  let cursor = from;

  while (cursor <= to) {
    const tentEnd = cursor + MAX_RANGE - 1n;
    const end = tentEnd > to ? to : tentEnd;
    counts.scannedChunks++;
    console.log(`[replay] chunk ${cursor}..${end}`);

    const [
      paidLogs,
      escrowCreatedLogs,
      refundedLogs,
      claimedLogs,
      escrowRecoveredLogs,
      merchantReactivatedLogs,
    ] = await Promise.all([
      chain.getLogs({ address: GATEWAY_V10, event: InvoicePaid,         fromBlock: cursor, toBlock: end }),
      chain.getLogs({ address: GATEWAY_V10, event: EscrowCreated,       fromBlock: cursor, toBlock: end }),
      chain.getLogs({ address: GATEWAY_V10, event: InvoiceRefunded,     fromBlock: cursor, toBlock: end }),
      chain.getLogs({ address: GATEWAY_V10, event: InvoiceClaimed,      fromBlock: cursor, toBlock: end }),
      chain.getLogs({ address: GATEWAY_V10, event: EscrowRecovered,     fromBlock: cursor, toBlock: end }),
      chain.getLogs({ address: GATEWAY_V10, event: MerchantReactivated, fromBlock: cursor, toBlock: end }),
    ]);

    for (const log of paidLogs) {
      const d = decodeEventLog({ abi: ABI, data: log.data, topics: log.topics });
      if (d.eventName !== "InvoicePaid") continue;
      const id              = d.args.globalId as Hex;
      const payer           = d.args.payer as string;
      const amountIn        = (d.args.amountIn        as bigint).toString();
      const merchantPayout  = (d.args.merchantPayout  as bigint).toString();
      const protocolFee     = (d.args.fee             as bigint).toString();

      if (dryRun) {
        console.log(`  [dry] would mark paid: ${id} (tx ${log.transactionHash})`);
        continue;
      }

      const upd = await pool.query<{ id: string; merchant_id: string }>(
        `update invoices
            set status = 'paid', paid_by = $2, paid_tx = $3, paid_at = now(),
                amount_in = $4, merchant_payout = $5, protocol_fee = $6
          where id = $1 and status = 'created'
          returning id, merchant_id`,
        [id, payer, log.transactionHash, amountIn, merchantPayout, protocolFee],
      );
      if (upd.rowCount && upd.rowCount > 0) {
        counts.paidUpdated++;
        await enqueueWebhook(id, upd.rows[0]!.merchant_id, "invoice.paid",
          { paid_by: payer }, log.transactionHash);
        counts.webhooksQueued++;
      }
    }

    // EscrowCreated → set claimable_at.
    // Guard: only update rows still in 'paid' state with no claimable_at set
    // (first sighting wins). On replay, already-claimed/refunded/recovered
    // rows are left untouched, preventing spurious overwrites of terminal state.
    for (const log of escrowCreatedLogs) {
      const d = decodeEventLog({ abi: ABI, data: log.data, topics: log.topics });
      if (d.eventName !== "EscrowCreated") continue;
      const id          = d.args.globalId as Hex;
      const claimableAt = d.args.claimableAt as bigint;

      if (dryRun) {
        console.log(`  [dry] would set claimable_at for escrow: ${id}`);
        continue;
      }
      await pool.query(
        `update invoices set claimable_at = to_timestamp($2)
           where id = $1 and status = 'paid' and claimable_at is null`,
        [id, Number(claimableAt)],
      );
    }

    for (const log of refundedLogs) {
      const d = decodeEventLog({ abi: ABI, data: log.data, topics: log.topics });
      if (d.eventName !== "InvoiceRefunded") continue;
      const id         = d.args.globalId as Hex;
      const refundedTo = d.args.refundedTo as string;

      if (dryRun) {
        console.log(`  [dry] would mark refunded: ${id} (tx ${log.transactionHash})`);
        continue;
      }

      const upd = await pool.query<{ id: string; merchant_id: string }>(
        `update invoices
            set status = 'refunded', refund_tx = $2, refunded_at = now()
          where id = $1 and status in ('created', 'paid')
          returning id, merchant_id`,
        [id, log.transactionHash],
      );
      if (upd.rowCount && upd.rowCount > 0) {
        counts.refundedUpdated++;
        await enqueueWebhook(id, upd.rows[0]!.merchant_id, "invoice.refunded",
          { refunded_to: refundedTo }, log.transactionHash);
        counts.webhooksQueued++;
      }
    }

    // InvoiceClaimed → flip status to 'claimed'
    for (const log of claimedLogs) {
      const d = decodeEventLog({ abi: ABI, data: log.data, topics: log.topics });
      if (d.eventName !== "InvoiceClaimed") continue;
      const id         = d.args.globalId as Hex;
      const fee        = (d.args.fee        as bigint).toString();
      const toMerchant = (d.args.toMerchant as bigint).toString();

      if (dryRun) {
        console.log(`  [dry] would mark claimed: ${id} (tx ${log.transactionHash})`);
        continue;
      }

      const upd = await pool.query<{ id: string; merchant_id: string }>(
        `update invoices
            set status          = 'claimed',
                claimed_at      = now(),
                claim_tx        = $2,
                protocol_fee    = $3,
                merchant_payout = $4
          where id = $1 and status = 'paid'
          returning id, merchant_id`,
        [id, log.transactionHash, fee, toMerchant],
      );
      if (upd.rowCount && upd.rowCount > 0) {
        counts.claimedUpdated++;
        await enqueueWebhook(id, upd.rows[0]!.merchant_id, "invoice.claimed",
          { fee, to_merchant: toMerchant }, log.transactionHash);
        counts.webhooksQueued++;
      }
    }

    // EscrowRecovered → flip status to 'recovered'
    for (const log of escrowRecoveredLogs) {
      const d = decodeEventLog({ abi: ABI, data: log.data, topics: log.topics });
      if (d.eventName !== "EscrowRecovered") continue;
      const id = d.args.globalId as Hex;

      if (dryRun) {
        console.log(`  [dry] would mark recovered: ${id} (tx ${log.transactionHash})`);
        continue;
      }

      const upd = await pool.query<{ id: string; merchant_id: string }>(
        `update invoices
            set status       = 'recovered',
                recovered_at = now(),
                recovery_tx  = $2
          where id = $1 and status = 'paid'
          returning id, merchant_id`,
        [id, log.transactionHash],
      );
      if (upd.rowCount && upd.rowCount > 0) {
        counts.recoveredUpdated++;
        await enqueueWebhook(id, upd.rows[0]!.merchant_id, "invoice.recovered",
          {}, log.transactionHash);
        counts.webhooksQueued++;
      }
    }

    // MerchantReactivated → clear deactivated_at.
    // Trade-off: no prior-state guard. On replay, spurious clears are
    // acceptable because the correct on-chain state is the most recent
    // event; if a deactivation replays after this, it will re-set the
    // column and converge to the correct value.
    for (const log of merchantReactivatedLogs) {
      const d = decodeEventLog({ abi: ABI, data: log.data, topics: log.topics });
      if (d.eventName !== "MerchantReactivated") continue;
      const merchant = (d.args.merchant as string).toLowerCase();

      if (dryRun) {
        console.log(`  [dry] would clear deactivated_at for merchant: ${merchant}`);
        continue;
      }
      await pool.query(
        `update merchants set deactivated_at = null where lower(address) = $1`,
        [merchant],
      );
    }

    cursor = end + 1n;
  }
  return counts;
}

async function reset(toBlock: bigint): Promise<void> {
  console.log(`[reset] setting indexer_state.last_processed_block = ${toBlock}`);
  await pool.query(
    `insert into indexer_state(key, value, updated_at)
     values ('last_processed_block', $1, now())
     on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at`,
    [toBlock.toString()],
  );
  const head = await chain.getBlockNumber();
  console.log(`[reset] done. Daemon will resume from block ${toBlock + 1n}; chain head is ${head}.`);
}

function parseArgs(argv: string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        out.set(key, "true"); // boolean flag
      } else {
        out.set(key, next);
        i++;
      }
    }
  }
  return out;
}

async function main() {
  const [, , subcommand, ...rest] = process.argv;
  const args = parseArgs(rest);

  try {
    if (subcommand === "reset") {
      const block = args.get("to-block");
      if (!block) throw new Error("usage: replay.ts reset --to-block <N>");
      await reset(BigInt(block));
    } else if (subcommand === "replay") {
      const from = args.get("from"), to = args.get("to");
      if (!from || !to) throw new Error("usage: replay.ts replay --from <A> --to <B> [--dry-run]");
      const counts = await replay(BigInt(from), BigInt(to), args.has("dry-run"));
      console.log(JSON.stringify({ msg: "replay.done", ...counts }, null, 2));
    } else {
      console.error("usage:");
      console.error("  replay.ts reset  --to-block <N>");
      console.error("  replay.ts replay --from <A> --to <B> [--dry-run]");
      process.exitCode = 2;
    }
  } finally {
    await pool.end();
  }
}

main().catch(e => {
  console.error("[replay] fatal:", e instanceof Error ? e.message : e);
  process.exit(1);
});
