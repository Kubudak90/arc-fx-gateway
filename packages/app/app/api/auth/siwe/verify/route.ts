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
  } catch (e: any) {
    return NextResponse.json({ error: "siwe_verify_failed", detail: e?.message }, { status: 401 });
  }
}
