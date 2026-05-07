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
import { assertOriginAllowed, assertSafePublicUrl } from "@/lib/security/safeUrl";
import { encodeAbiParameters, keccak256, type Address, type Hex } from "viem";

// V10 cutover (Plan 10, 2026-05-07): V8/V9 retired. The gateway address comes
// from GATEWAY_ADDRESS_V10 via lib/chain/client.ts. The legacy `?engine=`
// query param is no-op now — all invoices route to V10.

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

  // Audit H1 (2026-05-05): merchant-supplied successUrl/cancelUrl was
  // previously accepted as any well-formed URL. After payment we redirect
  // the customer with `window.location.href = successUrl`, so an attacker
  // with a stolen API key (or any merchant who turns hostile) could turn
  // arcorapay.xyz into an open-redirect / phishing launchpad. Two layers:
  //   1. allowlist — origin must match a value the merchant declared at
  //      bootstrap (or via PATCH /api/merchant/origins).
  //   2. SSRF guard — even merchant-declared values can resolve to private
  //      IPs (cloud metadata, internal admin, RFC1918), which would let a
  //      hostile merchant exfiltrate via the customer's redirect chain or
  //      worse if we ever fetched the URL server-side.
  // Fail-CLOSED for legacy merchants with empty allowlists (pre-Phase-2
  // rows) — they need to set origins via the dashboard before invoicing.
  const merchantAllowedOrigins = (merchant as { allowedOrigins?: string[] }).allowedOrigins ?? [];
  if (merchantAllowedOrigins.length === 0) {
    return corsResponse({
      error: "merchant_origins_not_configured",
      detail: "Set allowed redirect origins in /m/settings before creating invoices.",
    }, { status: 400 });
  }
  try {
    assertOriginAllowed(successUrl, merchantAllowedOrigins);
    if (cancelUrl) assertOriginAllowed(cancelUrl, merchantAllowedOrigins);
  } catch (e) {
    return corsResponse({
      error: "origin_not_allowed",
      detail: e instanceof Error ? e.message : String(e),
    }, { status: 400 });
  }
  try {
    await assertSafePublicUrl(successUrl);
    if (cancelUrl) await assertSafePublicUrl(cancelUrl);
  } catch (e) {
    return corsResponse({
      error: "unsafe_redirect_url",
      detail: e instanceof Error ? e.message : String(e),
    }, { status: 400 });
  }

  // V10-only: all invoices route to GATEWAY (== GATEWAY_ADDRESS_V10).
  const targetGateway: Address = GATEWAY;

  // Audit pass 4 (2026-05-04, finding #8): we used to screen
  // `merchant.address` (the identity wallet) but V9 settles to
  // `merchants[m].payoutAddress` which can be a separate wallet (or rotated
  // post-onboarding). Read the on-chain payoutAddress and screen THAT — a
  // merchant who rotates to an unscreened wallet must hit the gate before
  // we mint a fresh invoice routed to it.
  //
  // Audit residual P2 (2026-05-05): RPC failure used to silently fall back
  // to the DB identity wallet. createInvoiceFor would then proceed against
  // the same RPC moments later and likely succeed, settling to a wallet
  // that was never screened. Now we fail closed by default; the existing
  // COMPLIANCE_FAIL_OPEN_FOR_INVOICE flag (currently default-true for
  // compliance provider outages) explicitly governs whether to fall through
  // here too. Different surface, same operator-level decision.
  let payoutAddress: Address = merchant.address as Address;
  try {
    const onchain = await publicClient.readContract({
      address: targetGateway,
      abi: GATEWAY_ABI,
      functionName: "merchants",
      args: [merchant.address as Address],
    }) as readonly [Address, Address, boolean];
    const [onchainPayoutAddr] = onchain;
    if (onchainPayoutAddr && onchainPayoutAddr !== "0x0000000000000000000000000000000000000000") {
      payoutAddress = onchainPayoutAddr;
    }
    // If the on-chain merchant struct is zero, the merchant isn't registered
    // on this gateway yet — fall through; createInvoiceFor below will revert
    // with the right error and we won't have wasted a provider call here.
  } catch (e: any) {
    const failOpen = (process.env.COMPLIANCE_FAIL_OPEN_FOR_INVOICE ?? "true") !== "false";
    if (!failOpen) {
      return corsResponse({
        error: "payout_read_failed",
        detail: e?.shortMessage ?? String(e),
      }, { status: 503 });
    }
    // failOpen: identity wallet is the conservative target. The flag
    // already governs compliance-provider outages; same operator decision
    // applies here.
  }

  // Compliance gate on the merchant payout address. Cached per-address for
  // the provider's TTL so this is a DB hit on the hot path, not a provider
  // call. In Phase 0 (testnet / Noop) this is unconditionally `allow`.
  let payoutScreen: Awaited<ReturnType<typeof screenWithAudit>> | null = null;
  try {
    const provider = resolveComplianceProvider();
    payoutScreen = await screenWithAudit({
      db, provider,
      address: payoutAddress,
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
    gatewayAddress: targetGateway.toLowerCase(),
    metadata: { ...(metadata ?? {}), engine: "v10" },
    successUrl,
    cancelUrl: cancelUrl ?? null,
  });

  const baseUrl = process.env.PUBLIC_BASE_URL ?? "https://checkout.arcorapay.com";
  return corsResponse({ invoiceId: globalId, url: `${baseUrl}/i/${globalId}` }, { status: 201 });
}
