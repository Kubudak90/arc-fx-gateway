import { NextRequest, NextResponse } from "next/server";
import { publicClient, GATEWAY } from "@/lib/chain/client";
import { db } from "@/lib/db/client";
import { invoices, indexerState, webhookAttempts, merchants } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { decodeEventLog, parseAbi } from "viem";

const REORG_BUFFER = Number(process.env.INDEXER_REORG_BUFFER_BLOCKS ?? 5);

const InvoicePaidAbi = parseAbi([
  "event InvoicePaid(bytes32 indexed id, address indexed payer, uint256 amountIn, uint256 amountOut, uint256 fee)",
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

  const logs = await publicClient.getLogs({
    address: GATEWAY,
    event: InvoicePaidAbi[0],
    fromBlock,
    toBlock,
  });

  for (const log of logs) {
    const decoded = decodeEventLog({ abi: InvoicePaidAbi, data: log.data, topics: log.topics });
    const id = decoded.args.id as string;
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

  if (stateRows[0]) {
    await db.update(indexerState)
      .set({ value: toBlock.toString(), updatedAt: new Date() })
      .where(eq(indexerState.key, "last_processed_block"));
  } else {
    await db.insert(indexerState).values({ key: "last_processed_block", value: toBlock.toString() });
  }

  return NextResponse.json({ from: Number(fromBlock), to: Number(toBlock), processed: logs.length });
}
