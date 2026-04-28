import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { webhookAttempts, merchants, invoices } from "@/lib/db/schema";
import { and, eq, isNull, lte } from "drizzle-orm";
import { signWebhook } from "@/lib/crypto/webhook";
import { decrypt } from "@/lib/crypto/secret";

const BATCH = 50;
const MAX_BACKOFF_HOURS = 24;
const TERMINAL_4XX_AFTER = 3;

export async function POST(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const rows = await db
    .select({
      id: webhookAttempts.id,
      invoiceId: webhookAttempts.invoiceId,
      url: webhookAttempts.url,
      payload: webhookAttempts.payload,
      attempts: webhookAttempts.attempts,
      enc: merchants.webhookSecretEnc,
      iv: merchants.webhookSecretIv,
    })
    .from(webhookAttempts)
    .innerJoin(invoices, eq(invoices.id, webhookAttempts.invoiceId))
    .innerJoin(merchants, eq(merchants.id, invoices.merchantId))
    .where(and(isNull(webhookAttempts.succeededAt), lte(webhookAttempts.nextAttempt, new Date())))
    .limit(BATCH);

  let delivered = 0;
  for (const row of rows) {
    const secret = decrypt(row.iv as Buffer, row.enc as Buffer);
    const body = JSON.stringify(row.payload);
    const signature = signWebhook(body, secret);
    let ok = false;
    let lastError: string | undefined;
    let status = 0;
    try {
      const res = await fetch(row.url, {
        method: "POST",
        headers: { "content-type": "application/json", "X-Arcora-Signature": signature },
        body,
      });
      status = res.status;
      ok = res.ok;
      if (!ok) lastError = `${res.status} ${res.statusText}`;
    } catch (e: any) {
      lastError = e?.message ?? "network";
    }

    if (ok) {
      delivered++;
      await db.update(webhookAttempts)
        .set({ succeededAt: new Date() })
        .where(eq(webhookAttempts.id, row.id));
      continue;
    }

    const newAttempts = row.attempts + 1;
    if (status >= 400 && status < 500 && newAttempts >= TERMINAL_4XX_AFTER) {
      await db.update(webhookAttempts)
        .set({
          attempts: newAttempts,
          lastError,
          nextAttempt: new Date(Date.now() + MAX_BACKOFF_HOURS * 3600 * 1000),
        })
        .where(eq(webhookAttempts.id, row.id));
    } else {
      const backoffSec = Math.min(2 ** newAttempts, MAX_BACKOFF_HOURS * 3600);
      await db.update(webhookAttempts)
        .set({
          attempts: newAttempts,
          lastError,
          nextAttempt: new Date(Date.now() + backoffSec * 1000),
        })
        .where(eq(webhookAttempts.id, row.id));
    }
  }

  return NextResponse.json({ scanned: rows.length, delivered });
}
