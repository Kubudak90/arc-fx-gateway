import {
  createPublicClient, http, decodeEventLog, parseAbi,
  type Address, type Hex,
} from "viem";
import pg from "pg";
import { randomUUID } from "node:crypto";

const RPC          = need("ARC_TESTNET_RPC");
const GATEWAY_V10  = (process.env.GATEWAY_ADDRESS_V10 ?? "").toLowerCase() as Address;
if (!GATEWAY_V10) throw new Error("GATEWAY_ADDRESS_V10 must be set");
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
  "event SettlementContext(bytes32 indexed globalId, address indexed payInToken, bytes32 swapTxHash)",
  "event EscrowCreated(bytes32 indexed globalId, address indexed payoutToken, uint256 amount, uint64 claimableAt)",
  "event PayerRefunded(bytes32 indexed globalId, address indexed payer, address payInToken, uint256 amount, bytes32 reasonHash)",
  "event InvoiceRefunded(bytes32 indexed globalId, address indexed refundedTo, address indexed payoutToken, uint256 merchantPayout, uint256 protocolFeeReturned)",
  "event InvoiceClaimed(bytes32 indexed globalId, address indexed merchant, address payoutAddress, address payoutToken, uint256 toMerchant, uint256 fee)",
  "event EscrowRecovered(bytes32 indexed globalId, address indexed merchant, address payoutToken, uint256 amount, address to)",
  "event MerchantReactivated(address indexed merchant)",
]);
const InvoiceCreated     = ABI[0];
const InvoicePaid        = ABI[1];
const SettlementContext  = ABI[2];
const EscrowCreated      = ABI[3];
const PayerRefunded      = ABI[4];
const InvoiceRefunded    = ABI[5];
const InvoiceClaimed     = ABI[6];
const EscrowRecovered    = ABI[7];
const MerchantReactivated = ABI[8];

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

async function enqueueWebhook(
  pool: pg.Pool,
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
      JSON.stringify({ event_id: randomUUID(), type: eventType, invoice_id: invoiceId, tx_hash: txHash, ...extra }),
      eventType,
    ],
  );
}

async function tick(): Promise<{
  from: bigint; to: bigint; created: number; backfilled: number; paid: number;
  refunded: number; failed: number; claimed: number; recovered: number; chunks: number;
}> {
  const last = await getLastBlock();
  const head = await chain.getBlockNumber();
  const to   = head - REORG_BUFFER;
  let cursor = last + 1n;
  let created = 0, backfilled = 0, paid = 0, refunded = 0, failed = 0, claimed = 0, recovered = 0, chunks = 0;

  while (cursor <= to) {
    const tentEnd = cursor + MAX_RANGE - 1n;
    const end = tentEnd > to ? to : tentEnd;

    const [
      createdLogs,
      paidLogs,
      settleCtxLogs,
      escrowCreatedLogs,
      payerRefundedLogs,
      refundedLogs,
      claimedLogs,
      escrowRecoveredLogs,
      merchantReactivatedLogs,
    ] = await Promise.all([
      chain.getLogs({ address: GATEWAY_V10, event: InvoiceCreated,      fromBlock: cursor, toBlock: end }),
      chain.getLogs({ address: GATEWAY_V10, event: InvoicePaid,         fromBlock: cursor, toBlock: end }),
      chain.getLogs({ address: GATEWAY_V10, event: SettlementContext,   fromBlock: cursor, toBlock: end }),
      chain.getLogs({ address: GATEWAY_V10, event: EscrowCreated,       fromBlock: cursor, toBlock: end }),
      chain.getLogs({ address: GATEWAY_V10, event: PayerRefunded,       fromBlock: cursor, toBlock: end }),
      chain.getLogs({ address: GATEWAY_V10, event: InvoiceRefunded,     fromBlock: cursor, toBlock: end }),
      chain.getLogs({ address: GATEWAY_V10, event: InvoiceClaimed,      fromBlock: cursor, toBlock: end }),
      chain.getLogs({ address: GATEWAY_V10, event: EscrowRecovered,     fromBlock: cursor, toBlock: end }),
      chain.getLogs({ address: GATEWAY_V10, event: MerchantReactivated, fromBlock: cursor, toBlock: end }),
    ]);

    // Index SettlementContext by globalId so we can stitch payInToken +
    // swapTxHash onto the InvoicePaid row in the same chunk. V10 emits
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
          JSON.stringify({ backfilled: true, txHash: log.transactionHash, engine: "v10" }),
          GATEWAY_V10,
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

      await enqueueWebhook(pool, id, upd.rows[0].merchant_id, "invoice.paid",
        { paid_by: payer }, log.transactionHash);
    }

    for (const log of refundedLogs) {
      const d = decodeEventLog({ abi: ABI, data: log.data, topics: log.topics });
      if (d.eventName !== "InvoiceRefunded") continue;
      const id         = d.args.globalId as Hex;
      const refundedTo = d.args.refundedTo as string;

      // Status guard widened to include 'created' so an out-of-order
      // InvoiceRefunded (landing before InvoicePaid) still flips the row to
      // refunded — without this, the row sticks in 'created' forever despite
      // the customer being made whole on-chain.
      const upd = await pool.query<{ id: string; merchant_id: string }>(
        `update invoices
           set status = 'refunded', refund_tx = $2, refunded_at = now()
         where id = $1 and status in ('created', 'paid')
         returning id, merchant_id`,
        [id, log.transactionHash],
      );
      if (!upd.rowCount) continue;
      refunded++;

      await enqueueWebhook(pool, id, upd.rows[0].merchant_id, "invoice.refunded",
        { refunded_to: refundedTo }, log.transactionHash);
    }

    for (const log of payerRefundedLogs) {
      const d = decodeEventLog({ abi: ABI, data: log.data, topics: log.topics });
      if (d.eventName !== "PayerRefunded") continue;
      const id     = d.args.globalId as Hex;
      const payer  = d.args.payer as string;
      const amount = (d.args.amount as bigint).toString();

      // V10 path: the relayer couldn't settle, sent the customer their
      // pay-in back off-chain, and emitted this event so the indexer flips
      // the row to `failed`. webhooks fire so the merchant's app sees a
      // terminal "this won't pay" state.
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

      await enqueueWebhook(pool, id, upd.rows[0].merchant_id, "invoice.failed",
        { payer: payer.toLowerCase(), amount }, log.transactionHash);
    }

    // EscrowCreated → set claimable_at on the invoice row
    for (const log of escrowCreatedLogs) {
      const d = decodeEventLog({ abi: ABI, data: log.data, topics: log.topics });
      if (d.eventName !== "EscrowCreated") continue;
      const id          = d.args.globalId as Hex;
      const claimableAt = d.args.claimableAt as bigint;
      await pool.query(
        `update invoices set claimable_at = to_timestamp($2) where id = $1`,
        [id, Number(claimableAt)],
      );
    }

    // InvoiceClaimed → flip status to 'claimed', record claim_tx and fee
    for (const log of claimedLogs) {
      const d = decodeEventLog({ abi: ABI, data: log.data, topics: log.topics });
      if (d.eventName !== "InvoiceClaimed") continue;
      const id          = d.args.globalId as Hex;
      const fee         = (d.args.fee        as bigint).toString();
      const toMerchant  = (d.args.toMerchant as bigint).toString();

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
      if (!upd.rowCount) continue;
      claimed++;

      await enqueueWebhook(pool, id, upd.rows[0].merchant_id, "invoice.claimed",
        { fee, to_merchant: toMerchant }, log.transactionHash);
    }

    // EscrowRecovered → flip status to 'recovered'
    for (const log of escrowRecoveredLogs) {
      const d = decodeEventLog({ abi: ABI, data: log.data, topics: log.topics });
      if (d.eventName !== "EscrowRecovered") continue;
      const id = d.args.globalId as Hex;

      const upd = await pool.query<{ id: string; merchant_id: string }>(
        `update invoices
           set status       = 'recovered',
               recovered_at = now(),
               recovery_tx  = $2
         where id = $1 and status = 'paid'
         returning id, merchant_id`,
        [id, log.transactionHash],
      );
      if (!upd.rowCount) continue;
      recovered++;

      await enqueueWebhook(pool, id, upd.rows[0].merchant_id, "invoice.recovered",
        {}, log.transactionHash);
    }

    // MerchantReactivated → clear deactivated_at
    for (const log of merchantReactivatedLogs) {
      const d = decodeEventLog({ abi: ABI, data: log.data, topics: log.topics });
      if (d.eventName !== "MerchantReactivated") continue;
      const merchant = (d.args.merchant as string).toLowerCase();
      await pool.query(
        `update merchants set deactivated_at = null where lower(address) = $1`,
        [merchant],
      );
    }

    await setLastBlock(end);
    cursor = end + 1n;
    chunks++;
  }

  return { from: last + 1n, to, created, backfilled, paid, refunded, failed, claimed, recovered, chunks };
}

async function main() {
  console.log(JSON.stringify({
    msg: "indexer.start", gateway: GATEWAY_V10, tickMs: TICK_MS, reorgBuffer: REORG_BUFFER.toString(),
  }));
  const stop = async () => { await pool.end().catch(() => {}); process.exit(0); };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  while (true) {
    try {
      const r = await tick();
      if (r.created || r.paid || r.refunded || r.failed || r.claimed || r.recovered || r.backfilled || r.chunks > 1) {
        console.log(JSON.stringify({
          ts: new Date().toISOString(),
          from: r.from.toString(), to: r.to.toString(),
          created: r.created, backfilled: r.backfilled, paid: r.paid,
          refunded: r.refunded, failed: r.failed, claimed: r.claimed, recovered: r.recovered,
          chunks: r.chunks,
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
