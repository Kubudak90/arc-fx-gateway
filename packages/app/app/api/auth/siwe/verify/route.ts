import { NextRequest, NextResponse } from "next/server";
import { verifySiweMessage } from "@/lib/auth/siwe";
import { getSession } from "@/lib/auth/session";
import { z } from "zod";

const Body = z.object({ message: z.string(), signature: z.string() });

export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "bad_body" }, { status: 400 });
  try {
    const { address } = await verifySiweMessage(parsed.data);
    const session = await getSession();
    session.merchantAddress = address;
    await session.save();
    return NextResponse.json({ address });
  } catch (e: unknown) {
    // Audit M8 (2026-05-06): never leak internal error details to the client.
    // SIWE verification errors can contain nonce values, domain strings, or
    // chain IDs that help an attacker enumerate constraints. Log server-side
    // only and return a generic error code.
    console.warn("siwe/verify failed:", e instanceof Error ? e.message : String(e));
    return NextResponse.json({ error: "siwe_verify_failed" }, { status: 401 });
  }
}
