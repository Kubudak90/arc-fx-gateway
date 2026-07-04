import { NextRequest } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { createPublicClient, http, defineChain, type Address } from "viem";
import { db } from "@/lib/db/client";
import { invoices, settlements } from "@/lib/db/schema";
import { takeToken } from "@/lib/rate/limiter";
import { clientIp } from "@/lib/rate/clientIp";
import { getChainById, paymentEscrowAbi, selectRoute, type PayoutToken } from "@arcora/router";

const DEPOSIT_LIMIT = 20;
const DEPOSIT_WINDOW_SECONDS = 60;

/**
 * Record a v2 deposit. The buyer's browser calls this AFTER PaymentEscrow.deposit()
 * lands. No funds pass through us — we VERIFY the deposit on-chain (the escrow
 * exists, idemKeyToEscrow(invoiceRef) == escrowId, amount + payoutDomain match the
 * settlement) before advancing the settlement to DEPOSITED. Path A/B/C is fixed
 * here once the escrow (pay-from) domain is known.
 */
const Body = z.object({
  invoiceRef: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  escrowId: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  depositTx: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  escrowChainId: z.number().int().positive(),
});

export async function POST(req: NextRequest) {
  // Audit LOW (2026-07-04): this endpoint is public and does 3 RPC reads per
  // call — rate-limit per IP like the other public checkout routes (fail-open
  // on limiter outage, matching checkout/submit).
  const ip = clientIp(req);
  let allowed = true;
  try {
    allowed = await takeToken(`v2deposit:${ip}`, DEPOSIT_LIMIT, DEPOSIT_WINDOW_SECONDS);
  } catch {
    allowed = true;
  }
  if (!allowed) {
    return Response.json(
      { error: "rate_limited", retryAfterSeconds: DEPOSIT_WINDOW_SECONDS },
      { status: 429, headers: { "retry-after": String(DEPOSIT_WINDOW_SECONDS) } },
    );
  }

  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return Response.json({ error: "bad_body" }, { status: 400 });
  const { invoiceRef, escrowId, depositTx, escrowChainId } = parsed.data;

  const [s] = await db.select().from(settlements).where(eq(settlements.invoiceRef, invoiceRef)).limit(1);
  if (!s) return Response.json({ error: "unknown_invoice" }, { status: 404 });
  if (s.escrowId && s.escrowId.toLowerCase() !== escrowId.toLowerCase()) {
    return Response.json({ error: "escrow_mismatch" }, { status: 409 });
  }

  const chain = getChainById(escrowChainId);
  if (!chain || !chain.contracts.paymentEscrow || !chain.defaultRpcUrl) {
    return Response.json({ error: "chain_unsupported" }, { status: 400 });
  }

  const viemChain = defineChain({
    id: chain.chainId,
    name: chain.name,
    nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [chain.defaultRpcUrl] } },
  });
  const pc = createPublicClient({ chain: viemChain, transport: http(chain.defaultRpcUrl) });
  const escrowAddr = chain.contracts.paymentEscrow as Address;

  let onchainEscrowId: string;
  let escrow: readonly [Address, Address, bigint, bigint, number, number, number];
  let depositTxValid: boolean;
  try {
    onchainEscrowId = (await pc.readContract({
      address: escrowAddr, abi: paymentEscrowAbi, functionName: "idemKeyToEscrow", args: [invoiceRef as `0x${string}`],
    })) as string;
    escrow = (await pc.readContract({
      address: escrowAddr, abi: paymentEscrowAbi, functionName: "escrows", args: [escrowId as `0x${string}`],
    })) as readonly [Address, Address, bigint, bigint, number, number, number];
  } catch {
    return Response.json({ error: "chain_read_failed" }, { status: 502 });
  }
  // Audit LOW (2026-07-04): depositTx used to be persisted unverified — an
  // attacker who learned the invoiceRef could front-run the buyer's browser
  // and pin a bogus tx hash onto the invoice/settlement rows. Require the
  // claimed tx to be a successful call that emitted a Deposited log for THIS
  // escrowId from the escrow contract. A missing tx throws in viem, which is
  // the same verdict as a wrong one — both land on 409, not 502.
  try {
    const receipt = await pc.getTransactionReceipt({ hash: depositTx as `0x${string}` });
    depositTxValid = receipt.status === "success" && receipt.logs.some(
      (l) => l.address.toLowerCase() === escrowAddr.toLowerCase()
        && l.topics.some((t) => t?.toLowerCase() === escrowId.toLowerCase()),
    );
  } catch {
    depositTxValid = false;
  }
  if (!depositTxValid) {
    return Response.json({ error: "deposit_tx_mismatch" }, { status: 409 });
  }

  if (onchainEscrowId.toLowerCase() !== escrowId.toLowerCase()) {
    return Response.json({ error: "escrow_not_found" }, { status: 409 });
  }
  const [payer, , amount, , payoutDomain] = escrow;
  if (amount.toString() !== s.amount) return Response.json({ error: "amount_mismatch" }, { status: 409 });
  if (Number(payoutDomain) !== s.payoutDomain) return Response.json({ error: "payout_domain_mismatch" }, { status: 409 });

  const path = selectRoute({
    escrowDomain: chain.cctpDomain,
    payoutDomain: s.payoutDomain,
    payoutToken: s.payoutToken as PayoutToken,
  });

  // Audit #20: this endpoint is UNAUTHENTICATED and public, so the terminal-state writes must be
  // guarded — otherwise a replay flips an already-'paid' invoice back to 'paid', overwriting its
  // paidTx/paidBy. Gate on the pre-deposit 'created' state and use the row count as the guard.
  const paidRows = await db.update(invoices).set({
    escrowId,
    status: "paid",
    paidBy: payer,
    paidTx: depositTx,
    paidAt: new Date(),
  }).where(and(eq(invoices.id, invoiceRef), eq(invoices.status, "created"))).returning({ id: invoices.id });

  if (paidRows.length === 0) {
    // Not in the pre-deposit state. Treat a replay of the SAME escrow as an idempotent no-op;
    // reject any other terminal-state overwrite.
    const [inv] = await db
      .select({ status: invoices.status, escrowId: invoices.escrowId })
      .from(invoices)
      .where(eq(invoices.id, invoiceRef))
      .limit(1);
    if (inv?.status === "paid" && inv.escrowId?.toLowerCase() === escrowId.toLowerCase()) {
      return Response.json({ ok: true, escrowId, path, state: "DEPOSITED", idempotent: true });
    }
    return Response.json({ error: "invoice_not_pending", status: inv?.status ?? "unknown" }, { status: 409 });
  }

  // Only reached once (the invoice gate above ensures single execution), so the settlement
  // advance is safe. From the buyer's perspective payment is complete (USDC escrowed);
  // settlement to the merchant happens asynchronously after the refund window.
  await db.update(settlements).set({
    escrowId,
    escrowChainId,
    escrowDomain: chain.cctpDomain,
    path,
    state: "DEPOSITED",
    depositTx,
    payer,
    updatedAt: new Date(),
  }).where(eq(settlements.invoiceRef, invoiceRef));

  return Response.json({ ok: true, escrowId, path, state: "DEPOSITED" });
}
