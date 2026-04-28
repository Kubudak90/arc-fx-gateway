import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { lookupMerchantByApiKey } from "@/lib/auth/apikey";
import { GATEWAY_ABI } from "@/lib/chain/gateway-abi";
import { GATEWAY, getServerWalletClient, publicClient } from "@/lib/chain/client";
import { db } from "@/lib/db/client";
import { invoices } from "@/lib/db/schema";
import { encodeAbiParameters, keccak256, type Address, type Hex } from "viem";

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
      address: GATEWAY,
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
    metadata: metadata ?? null,
    successUrl,
    cancelUrl: cancelUrl ?? null,
  });

  const baseUrl = process.env.PUBLIC_BASE_URL ?? "https://checkout.arcorapay.com";
  return corsResponse({ invoiceId: globalId, url: `${baseUrl}/i/${globalId}` }, { status: 201 });
}
