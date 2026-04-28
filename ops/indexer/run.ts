import {
  createPublicClient, http, decodeEventLog, parseAbi,
  type Address, type Hex,
} from "viem";
import pg from "pg";
import { randomUUID } from "node:crypto";

const RPC          = need("ARC_TESTNET_RPC");
const GATEWAY      = need("GATEWAY_ADDRESS").toLowerCase() as Address;
const PG_URL       = need("POSTGRES_URL_NON_POOLING");
const REORG_BUFFER = BigInt(process.env.INDEXER_REORG_BUFFER_BLOCKS ?? "5");
const TICK_MS      = Number(process.env.INDEXER_TICK_MS ?? "30000");
const MAX_RANGE    = 9_000n; // Arc testnet eth_getLogs cap

function need(k: string): string {
  const v = process.env[k];
  if (!v) throw new Error(`missing env ${k}`);
  return v;
}

const ABI = parseAbi([
  "event InvoiceCreated(bytes32 indexed globalId, address indexed merchant, bytes32 indexed merchantInvoiceId, address payIn, address payoutToken, uint256 amountOut, uint64 expiresAt)",
  "event InvoicePaid(bytes32 indexed globalId, address indexed payer, uint256 amountIn, uint256 grossReceived, uint256 merchantPayout, uint256 fee)",
]);
const InvoiceCreated = ABI[0];
const InvoicePaid    = ABI[1];

const chain = createPublicClient({ transport: http(RPC) });
const pool  = new pg.Pool({ connectionString: PG_URL, ssl: { rejectUnauthorized: false } });

async function getLastBlock(): Promise<bigint> {
  const r = await pool.query<{ value: string }>(
    "select value from indexer_state where key = 'last_processed_block' limit 1",
  );
  return r.rows[0] ? BigInt(r.rows[0].value) : 0n;
}

async function setLastBlock(v: bigint): Promise<void> {
  await pool.query(
    `insert into indexer_state(key, value, updated_at)
     values ('last_processed_block', $1, now())
     on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at`,
    [v.toString()],
  );
}

async function tick(): Promise<{
  from: bigint; to: bigint; created: number; backfilled: number; paid: number; chunks: number;
}> {
  const last = await getLastBlock();
  const head = await chain.getBlockNumber();
  const to   = head - REORG_BUFFER;
  let cursor = last + 1n;
  let created = 0, backfilled = 0, paid = 0, chunks = 0;

  while (cursor <= to) {
    const tentEnd = cursor + MAX_RANGE - 1n;
    const end = tentEnd > to ? to : tentEnd;

    const [createdLogs, paidLogs] = await Promise.all([
      chain.getLogs({ address: GATEWAY, event: InvoiceCreated, fromBlock: cursor, toBlock: end }),
      chain.getLogs({ address: GATEWAY, event: InvoicePaid,    fromBlock: cursor, toBlock: end }),
    ]);

    for (const log of createdLogs) {
      const d = decodeEventLog({ abi: ABI, data: log.data, topics: log.topics });
      if (d.eventName !== "InvoiceCreated") continue;
      const a = d.args;
      const id            = a.globalId as Hex;
      const merchantAddr  = (a.merchant as string).toLowerCase();
      const exists = await pool.query("select 1 from invoices where id = $1", [id]);
      if (exists.rowCount && exists.rowCount > 0) continue;
      created++;

      const mr = await pool.query<{ id: string }>(
        "select id from merchants where lower(address) = $1 limit 1", [merchantAddr],
      );
      if (!mr.rowCount) continue; // unknown merchant - cannot satisfy FK

      await pool.query(
        `insert into invoices
           (id, merchant_invoice_id, merchant_id, pay_in_token, payout_token,
            amount_out, expires_at, status, success_url, metadata)
         values ($1, $2, $3, $4, $5, $6, to_timestamp($7), 'created', '', $8::jsonb)
         on conflict (id) do nothing`,
        [
          id,
          a.merchantInvoiceId as Hex,
          mr.rows[0].id,
          a.payIn as Hex,
          a.payoutToken as Hex,
          (a.amountOut as bigint).toString(),
          Number(a.expiresAt as bigint),
          JSON.stringify({ backfilled: true, txHash: log.transactionHash }),
        ],
      );
      backfilled++;
    }

    for (const log of paidLogs) {
      const d = decodeEventLog({ abi: ABI, data: log.data, topics: log.topics });
      if (d.eventName !== "InvoicePaid") continue;
      const id    = d.args.globalId as Hex;
      const payer = d.args.payer as string;

      const upd = await pool.query<{ id: string; merchant_id: string }>(
        `update invoices
           set status = 'paid', paid_by = $2, paid_tx = $3, paid_at = now()
         where id = $1 and status = 'created'
         returning id, merchant_id`,
        [id, payer, log.transactionHash],
      );
      if (!upd.rowCount) continue;
      paid++;

      const mr = await pool.query<{ webhook_url: string | null }>(
        "select webhook_url from merchants where id = $1", [upd.rows[0].merchant_id],
      );
      const url = mr.rows[0]?.webhook_url;
      if (url) {
        await pool.query(
          `insert into webhook_attempts(invoice_id, url, payload, attempts, next_attempt)
           values ($1, $2, $3::jsonb, 0, now())`,
          [
            id, url,
            JSON.stringify({
              event_id:   randomUUID(),
              type:       "invoice.paid",
              invoice_id: id,
              paid_by:    payer,
              tx_hash:    log.transactionHash,
            }),
          ],
        );
      }
    }

    await setLastBlock(end);
    cursor = end + 1n;
    chunks++;
  }

  return { from: last + 1n, to, created, backfilled, paid, chunks };
}

async function main() {
  console.log(JSON.stringify({
    msg: "indexer.start", gateway: GATEWAY, tickMs: TICK_MS, reorgBuffer: REORG_BUFFER.toString(),
  }));
  const stop = async () => { await pool.end().catch(() => {}); process.exit(0); };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  while (true) {
    try {
      const r = await tick();
      if (r.created || r.paid || r.backfilled || r.chunks > 1) {
        console.log(JSON.stringify({
          ts: new Date().toISOString(),
          from: r.from.toString(), to: r.to.toString(),
          created: r.created, backfilled: r.backfilled, paid: r.paid, chunks: r.chunks,
        }));
      }
    } catch (e) {
      console.error(JSON.stringify({
        ts: new Date().toISOString(), msg: "tick.error",
        error: e instanceof Error ? e.message : String(e),
      }));
    }
    await new Promise<void>(r => setTimeout(r, TICK_MS));
  }
}

main();
