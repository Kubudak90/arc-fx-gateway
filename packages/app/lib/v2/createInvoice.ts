// v2 chain-agnostic create-invoice (PLAN integration Phase 1). Unlike v1, this
// touches NO chain at create time: there is no server-wallet createInvoiceFor tx.
// It mints an off-chain `invoiceRef`, records the invoice + a `settlements` row
// (the durable Orchestrator Store), and returns a checkout URL where the BUYER
// calls PaymentEscrow.deposit() on their chosen chain. Idempotent on the
// Idempotency-Key header.
import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { invoices, settlements } from "@/lib/db/schema";
import { resolveComplianceProvider, complianceRequired } from "@/lib/compliance/factory";
import { screenWithAudit } from "@/lib/compliance/screen";
import { parseAmount, formatUnits, getChainById, type PayoutToken as Currency } from "@arcora/router";
import type { Address } from "viem";

export interface V2Merchant {
  id: string;
  address: string;
  payoutChainId: number | null;
  payoutAddress: string | null;
  payoutCurrency: Currency | null;
}

export interface V2CreateBody {
  amount: string; // decimal string in major units
  currency?: Currency; // override merchant payout currency (default = merchant's)
  successUrl?: string;
  cancelUrl?: string;
  metadata?: Record<string, string>;
}

export type V2Result = { http: number; body: unknown };

const USDC_DOMAIN_TOKEN = "USDC" as const;

export async function createInvoiceV2(
  merchant: V2Merchant,
  body: V2CreateBody,
  idempotencyKey: string | null,
  baseUrl: string,
): Promise<V2Result> {
  // Merchant must have a v2 payout config (own address + chain + currency).
  if (merchant.payoutChainId == null || !merchant.payoutAddress || !merchant.payoutCurrency) {
    return { http: 400, body: { error: "merchant_payout_not_configured", detail: "Set payout chain/currency/address (v2) before creating invoices." } };
  }
  const payoutChain = getChainById(merchant.payoutChainId);
  if (!payoutChain || !payoutChain.contracts.settlementReceiver) {
    return { http: 400, body: { error: "payout_chain_unsupported", detail: `No deployed v2 contracts for chain ${merchant.payoutChainId}.` } };
  }
  const currency = body.currency ?? merchant.payoutCurrency;

  // Amount → USDC minor units (the buyer always locks USDC). Reject floats/NaN.
  let amountMinor: bigint;
  try {
    amountMinor = parseAmount(body.amount);
  } catch (e) {
    return { http: 400, body: { error: "bad_amount", detail: e instanceof Error ? e.message : String(e) } };
  }

  // Idempotent create: a retried POST with the same key returns the same invoice.
  if (idempotencyKey) {
    const [existing] = await db
      .select({ id: invoices.id })
      .from(invoices)
      .where(and(eq(invoices.merchantId, merchant.id), eq(invoices.idempotencyKey, idempotencyKey)))
      .limit(1);
    if (existing) {
      return { http: 201, body: { invoiceId: existing.id, url: `${baseUrl}/i/${existing.id}` } };
    }
  }

  // Compliance gate re-anchored to the merchant's OWN stored payout address
  // (no on-chain custody gateway read in v2).
  try {
    const provider = resolveComplianceProvider();
    const screen = await screenWithAudit({
      db, provider,
      address: merchant.payoutAddress as Address,
      context: { flow: "merchant_payout", merchantId: merchant.id },
    });
    if (screen?.decision === "reject") {
      return { http: 403, body: { error: "merchant_payout_blocked", code: "MERCHANT_PAYOUT_BLOCKED" } };
    }
    if (screen?.decision === "review") {
      return { http: 202, body: { status: "queued", ticketId: screen.ticketId, reason: "Merchant payout address under compliance review." } };
    }
  } catch (e) {
    const failOpen = !complianceRequired() && (process.env.COMPLIANCE_FAIL_OPEN_FOR_INVOICE ?? "true") !== "false";
    if (!failOpen) return { http: 503, body: { error: "compliance_unavailable" } };
  }

  // invoiceRef is the chain-agnostic logical id (no domain — buyer hasn't chosen a
  // chain yet). It doubles as the on-chain deposit idemKey (one escrow per invoice).
  const invoiceRef = ("0x" + randomBytes(32).toString("hex")) as `0x${string}`;
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

  await db.insert(invoices).values({
    id: invoiceRef,
    merchantInvoiceId: invoiceRef,
    merchantId: merchant.id,
    payInToken: USDC_DOMAIN_TOKEN, // buyer always locks USDC (symbolic; per-chain addr resolved client-side)
    payoutToken: currency,
    amountOut: amountMinor.toString(),
    expiresAt,
    status: "created",
    currency,
    invoiceRef,
    idempotencyKey: idempotencyKey ?? null,
    metadata: body.metadata ?? {},
    successUrl: body.successUrl ?? "",
    cancelUrl: body.cancelUrl ?? null,
  });

  await db.insert(settlements).values({
    invoiceId: invoiceRef,
    invoiceRef,
    payoutChainId: merchant.payoutChainId,
    payoutDomain: payoutChain.cctpDomain,
    payoutToken: currency,
    amount: amountMinor.toString(),
    merchant: merchant.payoutAddress,
    state: "AWAITING_DEPOSIT",
  });

  return {
    http: 201,
    body: {
      invoiceId: invoiceRef,
      url: `${baseUrl}/i/${invoiceRef}`,
      amount: formatUnits(amountMinor),
      currency,
    },
  };
}
