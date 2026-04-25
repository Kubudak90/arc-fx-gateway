import { NextResponse } from "next/server";
import { generateNonce } from "@/lib/auth/siwe";

export async function POST() {
  const nonce = await generateNonce();
  return NextResponse.json({ nonce });
}
