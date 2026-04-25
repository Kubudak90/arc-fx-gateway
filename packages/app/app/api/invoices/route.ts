import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { lookupMerchantByApiKey } from "@/lib/auth/apikey";
import { GATEWAY_ABI } from "@/lib/chain/gateway-abi";
import { GATEWAY, getServerWalletClient, publicClient } from "@/lib/chain/client";
import { db } from "@/lib/db/client";
import { invoices } from "@/lib/db/schema";
import type { Address, Hex } from "viem";

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

export async function POST(req: NextRequest) {
  const apiKey = req.headers.get("X-Arc-Api-Key") ?? "";
  if (!apiKey) return NextResponse.json({ error: "missing_api_key" }, { status: 401 });
  const merchant = await lookupMerchantByApiKey(apiKey);
  if (!merchant) return NextResponse.json({ error: "invalid_api_key" }, { status: 401 });

  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "bad_body", detail: parsed.error.format() }, { status: 400 });
  const { amountUsdc, payInToken, successUrl, cancelUrl, metadata } = parsed.data;

  const invoiceId = ("0x" + randomBytes(32).toString("hex")) as Hex;
  const amountOut = BigInt(Math.round(amountUsdc * 1_000_000));
  const expiresAt = BigInt(Math.floor(Date.now() / 1000) + INVOICE_TTL_SEC);

  let txHash: Hex;
  try {
    const wallet = await getServerWalletClient();
    txHash = await wallet.writeContract({
      address: GATEWAY,
      abi: GATEWAY_ABI,
      functionName: "createInvoiceFor",
      args: [merchant.address as Address, invoiceId, TOKEN_ADDR[payInToken], amountOut, expiresAt],
    });
    await publicClient.waitForTransactionReceipt({ hash: txHash });
  } catch (e: any) {
    if (/DelegateNotAuthorized/.test(e?.shortMessage ?? "")) {
      return NextResponse.json({ error: "delegate_not_authorized" }, { status: 412 });
    }
    return NextResponse.json({ error: "chain_error", detail: e?.shortMessage ?? String(e) }, { status: 502 });
  }

  await db.insert(invoices).values({
    id: invoiceId,
    merchantId: merchant.id,
    payInToken: TOKEN_ADDR[payInToken],
    amountOut: amountOut.toString(),
    expiresAt: new Date(Number(expiresAt) * 1000),
    status: "created",
    metadata: metadata ?? null,
    successUrl,
    cancelUrl: cancelUrl ?? null,
  });

  const baseUrl = process.env.PUBLIC_BASE_URL ?? "https://checkout.arc-fx.xyz";
  return NextResponse.json({ invoiceId, url: `${baseUrl}/i/${invoiceId}` }, { status: 201 });
}
