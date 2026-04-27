import { generateNonce as siweGenerateNonce, SiweMessage } from "siwe";
import { db } from "@/lib/db/client";
import { siweNonces } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

const NONCE_TTL_MINUTES = 10;

export async function generateNonce(): Promise<string> {
  const nonce = siweGenerateNonce();
  const expiresAt = new Date(Date.now() + NONCE_TTL_MINUTES * 60_000);
  await db.insert(siweNonces).values({ nonce, expiresAt, used: false });
  return nonce;
}

export interface VerifyResult { address: string; chainId: number; }

export async function verifySiweMessage(args: { message: string; signature: string }): Promise<VerifyResult> {
  const siwe = new SiweMessage(args.message);
  const verification = await siwe.verify({ signature: args.signature });
  if (!verification.success) throw new Error("siwe signature invalid");

  const rows = await db.select().from(siweNonces).where(eq(siweNonces.nonce, siwe.nonce));
  if (rows.length === 0) throw new Error("siwe nonce unknown");
  const row = rows[0]!;
  if (row.used) throw new Error("siwe nonce already used");
  if (row.expiresAt.getTime() < Date.now()) throw new Error("siwe nonce expired");

  await db.update(siweNonces).set({ used: true }).where(eq(siweNonces.nonce, siwe.nonce));
  return { address: siwe.address, chainId: siwe.chainId };
}
