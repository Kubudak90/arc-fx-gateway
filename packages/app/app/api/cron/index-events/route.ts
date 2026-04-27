import { NextRequest, NextResponse } from "next/server";
import { publicClient, GATEWAY } from "@/lib/chain/client";
import { db } from "@/lib/db/client";
import { invoices, indexerState, webhookAttempts, merchants } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { decodeEventLog, parseAbi } from "viem";

const REORG_BUFFER = Number(process.env.INDEXER_REORG_BUFFER_BLOCKS ?? 5);
// Arc testnet RPC caps eth_getLogs at 10_000 blocks. Stay below that.
const MAX_RANGE = 9_000n;
// Vercel cron ticks once a minute; keep one tick under ~9s to leave headroom.
const MAX_CHUNKS_PER_INVOCATION = 30n;

const InvoicePaidAbi = parseAbi([
  "event InvoicePaid(bytes32 indexed globalId, address indexed payer, uint256 amountIn, uint256 grossReceived, uint256 merchantPayout, uint256 fee)",
]);

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
    return NextResponse.json({ from: Number(fromBlock), to: Number(toBlock), processed: 0 });
  }

  // Walk in chunks: the RPC caps eth_getLogs at 10k blocks, and a single
  // invocation has a wall-clock budget. Process up to MAX_CHUNKS_PER_INVOCATION
  // chunks; the next cron tick will pick up where this one left off.
  let cursor = fromBlock;
  let totalProcessed = 0;
  let chunksDone = 0n;
  let lastChunkEnd = fromBlock - 1n;

  while (cursor <= toBlock && chunksDone < MAX_CHUNKS_PER_INVOCATION) {
    const tentativeEnd = cursor + MAX_RANGE - 1n;
    const chunkEnd = tentativeEnd > toBlock ? toBlock : tentativeEnd;

    const logs = await publicClient.getLogs({
      address: GATEWAY,
      event: InvoicePaidAbi[0],
      fromBlock: cursor,
      toBlock: chunkEnd,
    });

    for (const log of logs) {
      const decoded = decodeEventLog({ abi: InvoicePaidAbi, data: log.data, topics: log.topics });
      const id = decoded.args.globalId as string;
      const payer = decoded.args.payer as string;

      await db.update(invoices)
        .set({ status: "paid", paidBy: payer, paidTx: log.transactionHash, paidAt: new Date() })
        .where(eq(invoices.id, id));

      const invRow = (await db.select().from(invoices).where(eq(invoices.id, id)).limit(1))[0];
      if (invRow) {
        const m = (await db.select().from(merchants).where(eq(merchants.id, invRow.merchantId)).limit(1))[0];
        if (m?.webhookUrl) {
          await db.insert(webhookAttempts).values({
            invoiceId: invRow.id,
            url: m.webhookUrl,
            payload: {
              event_id: crypto.randomUUID(),
              type: "invoice.paid",
              invoice_id: invRow.id,
              paid_by: payer,
              tx_hash: log.transactionHash,
            },
            attempts: 0,
            nextAttempt: new Date(),
          });
        }
      }
    }

    totalProcessed += logs.length;
    lastChunkEnd = chunkEnd;
    cursor = chunkEnd + 1n;
    chunksDone++;
  }

  // Persist the highest block we actually scanned (not toBlock — we may have
  // bailed early due to MAX_CHUNKS_PER_INVOCATION).
  if (stateRows[0]) {
    await db.update(indexerState)
      .set({ value: lastChunkEnd.toString(), updatedAt: new Date() })
      .where(eq(indexerState.key, "last_processed_block"));
  } else {
    await db.insert(indexerState).values({ key: "last_processed_block", value: lastChunkEnd.toString() });
  }

  return NextResponse.json({
    from: Number(fromBlock),
    to: Number(lastChunkEnd),
    head: Number(toBlock),
    processed: totalProcessed,
    chunks: Number(chunksDone),
    moreToProcess: cursor <= toBlock,
  });
}
