import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { lookupMerchantByApiKey } from "@/lib/auth/apikey";
import { GATEWAY_ABI } from "@/lib/chain/gateway-abi";
import { GATEWAY, getServerWalletClient, publicClient } from "@/lib/chain/client";
import { db } from "@/lib/db/client";
import { invoices } from "@/lib/db/schema";
import { resolveComplianceProvider } from "@/lib/compliance/factory";
import { screenWithAudit } from "@/lib/compliance/screen";
import { encodeAbiParameters, keccak256, type Address, type Hex } from "viem";

// Opt-in v0.8 path. Set via env on Vercel; merchants pass ?engine=v8 when
// calling /api/invoices to land their invoices on the relayer-driven gateway.
// Default behaviour is unchanged so existing v0.6 traffic isn't disturbed.
const GATEWAY_V8 = (process.env.GATEWAY_ADDRESS_V8 ?? "") as Address;

const Body = z.object({
  amountUsdc: z.number().positive(),
  payInToken: z.enum(["USDC", "EURC"]),
  successUrl: z.string().url(),
  cancelUrl: z.string().url().optional(),
  metadata: z.record(z.string()).optional(),
});

const TOKEN_ADDR: Record<"USDC" | "EURC", Address> = {
  USDC: (process.env.USDC_ADDRESS ?? "") as Address,
  EURC: (process.env.EURC_ADDRESS ?? "") as Address,
};

const INVOICE_TTL_SEC = 30 * 60;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, x-arcora-api-key",
  "Access-Control-Max-Age": "86400",
};

function corsResponse(body: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
  return NextResponse.json(body, { ...init, headers });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(req: NextRequest) {
  const apiKey = req.headers.get("X-Arcora-Api-Key") ?? "";
  if (!apiKey) return corsResponse({ error: "missing_api_key" }, { status: 401 });
  const merchant = await lookupMerchantByApiKey(apiKey);
  if (!merchant) return corsResponse({ error: "invalid_api_key" }, { status: 401 });

  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return corsResponse({ error: "bad_body", detail: parsed.error.format() }, { status: 400 });
  const { amountUsdc, payInToken, successUrl, cancelUrl, metadata } = parsed.data;

  // Compliance gate on the merchant payout address. Cached per-address for
  // the provider's TTL so this is a DB hit on the hot path, not a provider
  // call. In Phase 0 (testnet / Noop) this is unconditionally `allow`.
  let payoutScreen: Awaited<ReturnType<typeof screenWithAudit>> | null = null;
  try {
    const provider = resolveComplianceProvider();
    payoutScreen = await screenWithAudit({
      db, provider,
      address: merchant.address,
      context: { flow: "merchant_payout", merchantId: merchant.id },
    });
  } catch (e: any) {
    // Default fail-open for invoice creation: a provider outage shouldn't
    // block legitimate merchants. Override via COMPLIANCE_FAIL_OPEN_FOR_INVOICE=false.
    const failOpen = (process.env.COMPLIANCE_FAIL_OPEN_FOR_INVOICE ?? "true") !== "false";
    if (!failOpen) {
      return corsResponse({ error: "compliance_unavailable" }, { status: 503 });
    }
  }
  if (payoutScreen?.decision === "reject") {
    return corsResponse({
      error: "merchant_payout_blocked",
      code: "MERCHANT_PAYOUT_BLOCKED",
    }, { status: 403 });
  }
  if (payoutScreen?.decision === "review") {
    return corsResponse({
      status: "queued",
      ticketId: payoutScreen.ticketId,
      reason: "Merchant payout address is under compliance review. Invoice creation will resume once review completes.",
    }, { status: 202 });
  }

  const merchantInvoiceId = ("0x" + randomBytes(32).toString("hex")) as Hex;
  const globalId = keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "bytes32" }],
      [merchant.address as Address, merchantInvoiceId],
    ),
  );
  const amountOut = BigInt(Math.round(amountUsdc * 1_000_000));
  const expiresAt = BigInt(Math.floor(Date.now() / 1000) + INVOICE_TTL_SEC);

  // Engine selection: default to v0.6 (current production), let merchants
  // opt into v0.8 with `?engine=v8`. Both paths land an invoice in the same
  // DB row shape; the differentiator lives in `invoices.metadata.engine`,
  // which the hosted checkout reads to decide which PayButton to render.
  const engine = new URL(req.url).searchParams.get("engine") === "v8" ? "v8" : "v6";
  const targetGateway: Address = engine === "v8" ? GATEWAY_V8 : GATEWAY;
  if (engine === "v8" && !GATEWAY_V8) {
    return corsResponse({ error: "v8_gateway_not_configured" }, { status: 503 });
  }

  let txHash: Hex;
  try {
    const wallet = await getServerWalletClient();
    txHash = await wallet.writeContract({
      address: targetGateway,
      abi: GATEWAY_ABI,
      functionName: "createInvoiceFor",
      args: [merchant.address as Address, merchantInvoiceId, TOKEN_ADDR[payInToken], amountOut, expiresAt],
    });
    await publicClient.waitForTransactionReceipt({ hash: txHash });
  } catch (e: any) {
    if (/DelegateNotAuthorized/.test(e?.shortMessage ?? "")) {
      return corsResponse({ error: "delegate_not_authorized" }, { status: 412 });
    }
    return corsResponse({ error: "chain_error", detail: e?.shortMessage ?? String(e) }, { status: 502 });
  }

  await db.insert(invoices).values({
    id: globalId,
    merchantInvoiceId,
    merchantId: merchant.id,
    payInToken: TOKEN_ADDR[payInToken],
    payoutToken: merchant.payoutToken,
    amountOut: amountOut.toString(),
    expiresAt: new Date(Number(expiresAt) * 1000),
    status: "created",
    metadata: { ...(metadata ?? {}), engine },
    successUrl,
    cancelUrl: cancelUrl ?? null,
  });

  const baseUrl = process.env.PUBLIC_BASE_URL ?? "https://checkout.arcorapay.com";
  return corsResponse({ invoiceId: globalId, url: `${baseUrl}/i/${globalId}` }, { status: 201 });
}
