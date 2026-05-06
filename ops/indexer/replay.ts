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
 *     refunded rows, and DOES NOT touch indexer_state. Use this when you
 *     want a one-off catch-up without disturbing the daemon's cursor —
 *     for example, to backfill events emitted before the daemon was
 *     listening to v0.6.
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

const RPC          = need("ARC_TESTNET_RPC");
const GATEWAY      = need("GATEWAY_ADDRESS").toLowerCase() as Address;
const PG_URL       = need("POSTGRES_URL_NON_POOLING");
const MAX_RANGE    = 9_000n;

function need(k: string): string {
  const v = process.env[k];
  if (!v) throw new Error(`missing env ${k}`);
  return v;
}

const ABI = parseAbi([
  "event InvoiceCreated(bytes32 indexed globalId, address indexed merchant, bytes32 indexed merchantInvoiceId, address payIn, address payoutToken, uint256 amountOut, uint64 expiresAt)",
  "event InvoicePaid(bytes32 indexed globalId, address indexed payer, uint256 amountIn, uint256 grossReceived, uint256 merchantPayout, uint256 fee)",
  "event InvoiceRefunded(bytes32 indexed globalId, address indexed refundedTo, address indexed payoutToken, uint256 merchantPayout, uint256 protocolFeeReturned)",
]);
const InvoiceCreated  = ABI[0];
const InvoicePaid     = ABI[1];
const InvoiceRefunded = ABI[2];

const chain = createPublicClient({ transport: http(RPC) });
const pool  = new pg.Pool({ connectionString: PG_URL, ssl: { rejectUnauthorized: false } });

interface ReplayCounts {
  scannedChunks: number;
  paidUpdated:   number;
  refundedUpdated: number;
  webhooksQueued: number;
}

async function replay(from: bigint, to: bigint, dryRun: boolean): Promise<ReplayCounts> {
  const counts: ReplayCounts = { scannedChunks: 0, paidUpdated: 0, refundedUpdated: 0, webhooksQueued: 0 };
  let cursor = from;

  while (cursor <= to) {
    const tentEnd = cursor + MAX_RANGE - 1n;
    const end = tentEnd > to ? to : tentEnd;
    counts.scannedChunks++;
    console.log(`[replay] chunk ${cursor}..${end}`);

    const [paidLogs, refundedLogs] = await Promise.all([
      chain.getLogs({ address: GATEWAY, event: InvoicePaid,     fromBlock: cursor, toBlock: end }),
      chain.getLogs({ address: GATEWAY, event: InvoiceRefunded, fromBlock: cursor, toBlock: end }),
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
        const mr = await pool.query<{ webhook_url: string | null }>(
          "select webhook_url from merchants where id = $1", [upd.rows[0]!.merchant_id],
        );
        const url = mr.rows[0]?.webhook_url;
        if (url) {
          await pool.query(
            `insert into webhook_attempts(invoice_id, url, payload, attempts, next_attempt, event_type)
             values ($1, $2, $3::jsonb, 0, now(), $4)
             on conflict (invoice_id, event_type) do nothing`,
            [id, url, JSON.stringify({
              event_id: randomUUID(), type: "invoice.paid",
              invoice_id: id, paid_by: payer, tx_hash: log.transactionHash,
              replay: true,
            }), "invoice.paid"],
          );
          counts.webhooksQueued++;
        }
      }
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
          where id = $1 and status = 'paid'
          returning id, merchant_id`,
        [id, log.transactionHash],
      );
      if (upd.rowCount && upd.rowCount > 0) {
        counts.refundedUpdated++;
        const mr = await pool.query<{ webhook_url: string | null }>(
          "select webhook_url from merchants where id = $1", [upd.rows[0]!.merchant_id],
        );
        const url = mr.rows[0]?.webhook_url;
        if (url) {
          await pool.query(
            `insert into webhook_attempts(invoice_id, url, payload, attempts, next_attempt, event_type)
             values ($1, $2, $3::jsonb, 0, now(), $4)
             on conflict (invoice_id, event_type) do nothing`,
            [id, url, JSON.stringify({
              event_id: randomUUID(), type: "invoice.refunded",
              invoice_id: id, refunded_to: refundedTo, tx_hash: log.transactionHash,
              replay: true,
            }), "invoice.refunded"],
          );
          counts.webhooksQueued++;
        }
      }
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
