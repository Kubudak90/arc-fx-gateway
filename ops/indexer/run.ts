import {
  createPublicClient, http, decodeEventLog, parseAbi,
  type Address, type Hex,
} from "viem";
import pg from "pg";
import { randomUUID } from "node:crypto";

const RPC          = need("ARC_TESTNET_RPC");
const GATEWAY      = need("GATEWAY_ADDRESS").toLowerCase() as Address;
// V8 + V9 gateways. The indexer watches each one in parallel; events from
// V9 are decode-compatible with V8 because event signatures are unchanged.
// V9 also emits `SettlementSource` (new in v0.9, Plan 9) which the decoder
// silently ignores — we read payoutSource from storage when needed. As soon
// as the V8 in-flight cohort drains we can drop V8 from the list.
// Optional V6 cohort: legacy `GATEWAY_ADDRESS` already covers our pre-V8
// indexing path, but the explicit env makes operator intent obvious and lets
// us drop V6 cleanly once that in-flight cohort drains. Audit M6 (2026-05-05).
const GATEWAY_V6   = (process.env.GATEWAY_ADDRESS_V6 ?? "").toLowerCase() as Address;
const GATEWAY_V8   = (process.env.GATEWAY_ADDRESS_V8 ?? "").toLowerCase() as Address;
const GATEWAY_V9   = (process.env.GATEWAY_ADDRESS_V9 ?? "").toLowerCase() as Address;
const PG_URL       = need("POSTGRES_URL_NON_POOLING");
const REORG_BUFFER = BigInt(process.env.INDEXER_REORG_BUFFER_BLOCKS ?? "5");
const TICK_MS      = Number(process.env.INDEXER_TICK_MS ?? "30000");
const MAX_RANGE    = 9_000n; // Arc testnet eth_getLogs cap

const GATEWAYS: Address[] = [GATEWAY, GATEWAY_V6, GATEWAY_V8, GATEWAY_V9].filter(
  (a): a is Address => Boolean(a) && a.startsWith("0x"),
) as Address[];

function need(k: string): string {
  const v = process.env[k];
  if (!v) throw new Error(`missing env ${k}`);
  return v;
}

const ABI = parseAbi([
  "event InvoiceCreated(bytes32 indexed globalId, address indexed merchant, bytes32 indexed merchantInvoiceId, address payIn, address payoutToken, uint256 amountOut, uint64 expiresAt)",
  "event InvoicePaid(bytes32 indexed globalId, address indexed payer, uint256 amountIn, uint256 grossReceived, uint256 merchantPayout, uint256 fee)",
  "event InvoiceRefunded(bytes32 indexed globalId, address indexed refundedTo, address indexed payoutToken, uint256 merchantPayout, uint256 protocolFeeReturned)",
  // v0.8-only events. v0.6 contracts never emit these so the topic filter
  // is a no-op when only the legacy gateway is present.
  "event SettlementContext(bytes32 indexed globalId, address indexed payInToken, bytes32 swapTxHash)",
  "event PayerRefunded(bytes32 indexed globalId, address indexed payer, address payInToken, uint256 amount, bytes32 reasonHash)",
]);
const InvoiceCreated     = ABI[0];
const InvoicePaid        = ABI[1];
const InvoiceRefunded    = ABI[2];
const SettlementContext  = ABI[3];
const PayerRefunded      = ABI[4];

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
  from: bigint; to: bigint; created: number; backfilled: number; paid: number; refunded: number; failed: number; chunks: number;
}> {
  const last = await getLastBlock();
  const head = await chain.getBlockNumber();
  const to   = head - REORG_BUFFER;
  let cursor = last + 1n;
  let created = 0, backfilled = 0, paid = 0, refunded = 0, failed = 0, chunks = 0;

  while (cursor <= to) {
    const tentEnd = cursor + MAX_RANGE - 1n;
    const end = tentEnd > to ? to : tentEnd;

    // viem accepts an array for `address` so a single getLogs call matches
    // logs from either gateway (saves us from issuing 2× the requests).
    const addr = GATEWAYS.length === 1 ? GATEWAYS[0]! : GATEWAYS;
    const [createdLogs, paidLogs, refundedLogs, settleCtxLogs, payerRefundedLogs] = await Promise.all([
      chain.getLogs({ address: addr, event: InvoiceCreated,    fromBlock: cursor, toBlock: end }),
      chain.getLogs({ address: addr, event: InvoicePaid,       fromBlock: cursor, toBlock: end }),
      chain.getLogs({ address: addr, event: InvoiceRefunded,   fromBlock: cursor, toBlock: end }),
      chain.getLogs({ address: addr, event: SettlementContext, fromBlock: cursor, toBlock: end }),
      chain.getLogs({ address: addr, event: PayerRefunded,     fromBlock: cursor, toBlock: end }),
    ]);

    // Index SettlementContext by globalId so we can stitch payInToken +
    // swapTxHash onto the InvoicePaid row in the same chunk. v0.8 emits
    // both in the same tx; if they ever land in adjacent chunks we still
    // catch them on the next tick (Created stays as 'created' until Paid).
    const settleCtxByInvoice = new Map<string, { payInToken: string; swapTxHash: string }>();
    for (const log of settleCtxLogs) {
      const d = decodeEventLog({ abi: ABI, data: log.data, topics: log.topics });
      if (d.eventName !== "SettlementContext") continue;
      const id = d.args.globalId as Hex;
      settleCtxByInvoice.set(id.toLowerCase(), {
        payInToken: (d.args.payInToken as string).toLowerCase(),
        swapTxHash: d.args.swapTxHash as string,
      });
    }

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

      // Audit pass 4 (2026-05-04, finding #9): backfill row used to write
      // gateway_address NULL and metadata { backfilled, txHash } only — the
      // checkout page then defaulted missing metadata.engine to v6, and
      // the relayer used the legacy GATEWAY for routing. If the post-
      // createInvoiceFor INSERT in /api/invoices ever failed, this recovery
      // path produced silently mis-routed invoices. Now we stamp both the
      // emitting gateway and the derived engine.
      const emittingGateway = log.address.toLowerCase();
      const engineForGateway: "v6" | "v8" | "v9" =
        emittingGateway === GATEWAY_V9 ? "v9" :
        emittingGateway === GATEWAY_V8 ? "v8" :
        emittingGateway === GATEWAY_V6 ? "v6" :
        "v6"; // default for legacy GATEWAY_ADDRESS
      await pool.query(
        `insert into invoices
           (id, merchant_invoice_id, merchant_id, pay_in_token, payout_token,
            amount_out, expires_at, status, success_url, metadata, gateway_address)
         values ($1, $2, $3, $4, $5, $6, to_timestamp($7), 'created', '', $8::jsonb, $9)
         on conflict (id) do nothing`,
        [
          id,
          a.merchantInvoiceId as Hex,
          mr.rows[0].id,
          a.payIn as Hex,
          a.payoutToken as Hex,
          (a.amountOut as bigint).toString(),
          Number(a.expiresAt as bigint),
          JSON.stringify({ backfilled: true, txHash: log.transactionHash, engine: engineForGateway }),
          emittingGateway,
        ],
      );
      backfilled++;
    }

    for (const log of paidLogs) {
      const d = decodeEventLog({ abi: ABI, data: log.data, topics: log.topics });
      if (d.eventName !== "InvoicePaid") continue;
      const id              = d.args.globalId as Hex;
      const payer           = d.args.payer as string;
      const amountIn        = (d.args.amountIn        as bigint).toString();
      const merchantPayout  = (d.args.merchantPayout  as bigint).toString();
      const protocolFee     = (d.args.fee             as bigint).toString();

      const ctx = settleCtxByInvoice.get(id.toLowerCase());
      const upd = await pool.query<{ id: string; merchant_id: string }>(
        `update invoices
           set status = 'paid', paid_by = $2, paid_tx = $3, paid_at = now(),
               amount_in = $4, merchant_payout = $5, protocol_fee = $6,
               metadata  = coalesce(metadata, '{}'::jsonb) || $7::jsonb
         where id = $1 and status = 'created'
         returning id, merchant_id`,
        [
          id, payer, log.transactionHash, amountIn, merchantPayout, protocolFee,
          ctx
            ? JSON.stringify({ pay_in_actual: ctx.payInToken, swap_tx: ctx.swapTxHash, source_address: log.address })
            : JSON.stringify({ source_address: log.address }),
        ],
      );
      if (!upd.rowCount) continue;
      paid++;

      const mr = await pool.query<{ webhook_url: string | null }>(
        "select webhook_url from merchants where id = $1", [upd.rows[0].merchant_id],
      );
      const url = mr.rows[0]?.webhook_url;
      if (url) {
        await pool.query(
          `insert into webhook_attempts(invoice_id, url, payload, attempts, next_attempt, event_type)
           values ($1, $2, $3::jsonb, 0, now(), $4)
           on conflict (invoice_id, event_type) do nothing`,
          [
            id, url,
            JSON.stringify({
              event_id:   randomUUID(),
              type:       "invoice.paid",
              invoice_id: id,
              paid_by:    payer,
              tx_hash:    log.transactionHash,
            }),
            "invoice.paid",
          ],
        );
      }
    }

    for (const log of refundedLogs) {
      const d = decodeEventLog({ abi: ABI, data: log.data, topics: log.topics });
      if (d.eventName !== "InvoiceRefunded") continue;
      const id         = d.args.globalId as Hex;
      const refundedTo = d.args.refundedTo as string;

      // Status guard widened to include 'created' so an out-of-order
      // InvoiceRefunded (landing before InvoicePaid) still flips the row to
      // refunded — without this, the row sticks in 'created' forever despite
      // the customer being made whole on-chain. Audit H5 (2026-05-05).
      const upd = await pool.query<{ id: string; merchant_id: string }>(
        `update invoices
           set status = 'refunded', refund_tx = $2, refunded_at = now()
         where id = $1 and status in ('created', 'paid')
         returning id, merchant_id`,
        [id, log.transactionHash],
      );
      if (!upd.rowCount) continue;
      refunded++;

      const mr = await pool.query<{ webhook_url: string | null }>(
        "select webhook_url from merchants where id = $1", [upd.rows[0].merchant_id],
      );
      const url = mr.rows[0]?.webhook_url;
      if (url) {
        await pool.query(
          `insert into webhook_attempts(invoice_id, url, payload, attempts, next_attempt, event_type)
           values ($1, $2, $3::jsonb, 0, now(), $4)
           on conflict (invoice_id, event_type) do nothing`,
          [
            id, url,
            JSON.stringify({
              event_id:    randomUUID(),
              type:        "invoice.refunded",
              invoice_id:  id,
              refunded_to: refundedTo,
              tx_hash:     log.transactionHash,
            }),
            "invoice.refunded",
          ],
        );
      }
    }

    for (const log of payerRefundedLogs) {
      const d = decodeEventLog({ abi: ABI, data: log.data, topics: log.topics });
      if (d.eventName !== "PayerRefunded") continue;
      const id     = d.args.globalId as Hex;
      const payer  = d.args.payer as string;
      const amount = (d.args.amount as bigint).toString();

      // v0.8 path only: the relayer couldn't settle, sent the customer their
      // pay-in back off-chain, and emitted this event so the indexer flips
      // the row to `failed`. webhooks fire so the merchant's app sees a
      // terminal "this won't pay" state.
      //
      // Status guard widened to include 'paid' so an out-of-order PayerRefunded
      // (landing after a stray InvoicePaid for the same globalId) still flips
      // the row to 'failed' — the customer got their money back, the merchant
      // must not see this as a successful sale. PayerRefunded is the v0.8
      // "settle did not happen" signal, NOT a refund of a paid invoice
      // (that's InvoiceRefunded), so the literal stays 'failed'. Audit H5
      // (2026-05-05).
      const upd = await pool.query<{ id: string; merchant_id: string }>(
        `update invoices
           set status   = 'failed',
               metadata = coalesce(metadata, '{}'::jsonb) || $2::jsonb
         where id = $1 and status in ('created', 'paid')
         returning id, merchant_id`,
        [
          id,
          JSON.stringify({
            failed_at:    new Date().toISOString(),
            failed_tx:    log.transactionHash,
            refunded_to:  payer.toLowerCase(),
            refund_amount: amount,
          }),
        ],
      );
      if (!upd.rowCount) continue;
      failed++;

      const mr = await pool.query<{ webhook_url: string | null }>(
        "select webhook_url from merchants where id = $1", [upd.rows[0].merchant_id],
      );
      const url = mr.rows[0]?.webhook_url;
      if (url) {
        await pool.query(
          `insert into webhook_attempts(invoice_id, url, payload, attempts, next_attempt, event_type)
           values ($1, $2, $3::jsonb, 0, now(), $4)
           on conflict (invoice_id, event_type) do nothing`,
          [
            id, url,
            JSON.stringify({
              event_id:    randomUUID(),
              type:        "invoice.failed",
              invoice_id:  id,
              payer:       payer.toLowerCase(),
              amount,
              tx_hash:     log.transactionHash,
            }),
            "invoice.failed",
          ],
        );
      }
    }

    await setLastBlock(end);
    cursor = end + 1n;
    chunks++;
  }

  return { from: last + 1n, to, created, backfilled, paid, refunded, failed, chunks };
}

async function main() {
  console.log(JSON.stringify({
    msg: "indexer.start", gateways: GATEWAYS, tickMs: TICK_MS, reorgBuffer: REORG_BUFFER.toString(),
  }));
  const stop = async () => { await pool.end().catch(() => {}); process.exit(0); };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  while (true) {
    try {
      const r = await tick();
      if (r.created || r.paid || r.refunded || r.failed || r.backfilled || r.chunks > 1) {
        console.log(JSON.stringify({
          ts: new Date().toISOString(),
          from: r.from.toString(), to: r.to.toString(),
          created: r.created, backfilled: r.backfilled, paid: r.paid, refunded: r.refunded, failed: r.failed, chunks: r.chunks,
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
