import { NextRequest, NextResponse } from "next/server";
import { publicClient, GATEWAY } from "@/lib/chain/client";
import { db } from "@/lib/db/client";
import { invoices, indexerState, webhookAttempts, merchants } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { decodeEventLog, parseAbi, type Hex } from "viem";

const REORG_BUFFER = Number(process.env.INDEXER_REORG_BUFFER_BLOCKS ?? 5);
// Arc testnet RPC caps eth_getLogs at 10_000 blocks. Stay below that.
const MAX_RANGE = 9_000n;
// Vercel cron ticks once a minute; keep one tick under ~9s to leave headroom.
const MAX_CHUNKS_PER_INVOCATION = 30n;

const GatewayEventsAbi = parseAbi([
  "event InvoiceCreated(bytes32 indexed globalId, address indexed merchant, bytes32 indexed merchantInvoiceId, address payIn, address payoutToken, uint256 amountOut, uint64 expiresAt)",
  "event InvoicePaid(bytes32 indexed globalId, address indexed payer, uint256 amountIn, uint256 grossReceived, uint256 merchantPayout, uint256 fee)",
]);
const InvoiceCreatedEvent = GatewayEventsAbi[0];
const InvoicePaidEvent    = GatewayEventsAbi[1];

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
    return NextResponse.json({ from: Number(fromBlock), to: Number(toBlock), created: 0, paid: 0 });
  }

  let cursor = fromBlock;
  let createdCount = 0;
  let createdBackfilled = 0;
  let paidCount = 0;
  let chunksDone = 0n;
  let lastChunkEnd = fromBlock - 1n;

  while (cursor <= toBlock && chunksDone < MAX_CHUNKS_PER_INVOCATION) {
    const tentativeEnd = cursor + MAX_RANGE - 1n;
    const chunkEnd = tentativeEnd > toBlock ? toBlock : tentativeEnd;

    // Pull both events in two parallel filtered calls (RPC has no OR over event topics).
    const [createdLogs, paidLogs] = await Promise.all([
      publicClient.getLogs({ address: GATEWAY, event: InvoiceCreatedEvent, fromBlock: cursor, toBlock: chunkEnd }),
      publicClient.getLogs({ address: GATEWAY, event: InvoicePaidEvent,    fromBlock: cursor, toBlock: chunkEnd }),
    ]);

    // Process Created first so a Paid event in the same chunk has the row to update.
    for (const log of createdLogs) {
      const decoded = decodeEventLog({ abi: GatewayEventsAbi, data: log.data, topics: log.topics });
      if (decoded.eventName !== "InvoiceCreated") continue;
      const a = decoded.args;
      const globalId         = a.globalId as Hex;
      const merchantAddress  = (a.merchant as string).toLowerCase();
      const merchantInvoiceId = a.merchantInvoiceId as Hex;
      const payIn            = a.payIn as Hex;
      const payoutToken      = a.payoutToken as Hex;
      const amountOut        = a.amountOut as bigint;
      const expiresAt        = new Date(Number(a.expiresAt as bigint) * 1000);

      const existing = (await db.select().from(invoices).where(eq(invoices.id, globalId)).limit(1))[0];
      if (existing) continue; // The API path already wrote it; nothing to backfill.
      createdCount++;

      const m = (await db.select().from(merchants).where(eq(merchants.address, merchantAddress)).limit(1))[0];
      if (!m) continue; // unknown merchant — can't satisfy the FK; skip.

      await db.insert(invoices).values({
        id:                globalId,
        merchantInvoiceId,
        merchantId:        m.id,
        payInToken:        payIn,
        payoutToken,
        amountOut:         amountOut.toString(),
        expiresAt,
        status:            "created",
        successUrl:        "",  // unknown — onchain event doesn't carry this
        cancelUrl:         null,
        metadata:          { backfilled: true, txHash: log.transactionHash },
      }).onConflictDoNothing();
      createdBackfilled++;
    }

    for (const log of paidLogs) {
      const decoded = decodeEventLog({ abi: GatewayEventsAbi, data: log.data, topics: log.topics });
      if (decoded.eventName !== "InvoicePaid") continue;
      const id = decoded.args.globalId as Hex;
      const payer = decoded.args.payer as string;

      const updated = await db.update(invoices)
        .set({ status: "paid", paidBy: payer, paidTx: log.transactionHash, paidAt: new Date() })
        .where(and(eq(invoices.id, id), eq(invoices.status, "created")))
        .returning({ id: invoices.id, merchantId: invoices.merchantId });

      if (updated.length === 0) continue; // already paid or row absent
      paidCount++;

      const invRow = updated[0]!;
      const m = (await db.select().from(merchants).where(eq(merchants.id, invRow.merchantId)).limit(1))[0];
      if (m?.webhookUrl) {
        await db.insert(webhookAttempts).values({
          invoiceId: invRow.id,
          url:       m.webhookUrl,
          payload: {
            event_id:    crypto.randomUUID(),
            type:        "invoice.paid",
            invoice_id:  invRow.id,
            paid_by:     payer,
            tx_hash:     log.transactionHash,
          },
          attempts:    0,
          nextAttempt: new Date(),
        });
      }
    }

    lastChunkEnd = chunkEnd;
    cursor = chunkEnd + 1n;
    chunksDone++;
  }

  if (stateRows[0]) {
    await db.update(indexerState)
      .set({ value: lastChunkEnd.toString(), updatedAt: new Date() })
      .where(eq(indexerState.key, "last_processed_block"));
  } else {
    await db.insert(indexerState).values({ key: "last_processed_block", value: lastChunkEnd.toString() });
  }

  return NextResponse.json({
    from:           Number(fromBlock),
    to:             Number(lastChunkEnd),
    head:           Number(toBlock),
    created:        createdCount,
    backfilled:     createdBackfilled,
    paid:           paidCount,
    chunks:         Number(chunksDone),
    moreToProcess:  cursor <= toBlock,
  });
}
