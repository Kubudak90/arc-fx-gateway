import { NextRequest } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { createPublicClient, http, defineChain, type Address } from "viem";
import { db } from "@/lib/db/client";
import { invoices, settlements } from "@/lib/db/schema";
import { getChainById, paymentEscrowAbi, selectRoute, type PayoutToken } from "@arcora/router";

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

  // From the buyer's perspective payment is complete (USDC escrowed). Settlement
  // to the merchant happens asynchronously after the refund window.
  await db.update(invoices).set({
    escrowId,
    status: "paid",
    paidBy: payer,
    paidTx: depositTx,
    paidAt: new Date(),
  }).where(eq(invoices.id, invoiceRef));

  return Response.json({ ok: true, escrowId, path, state: "DEPOSITED" });
}
