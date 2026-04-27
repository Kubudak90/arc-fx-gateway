import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";

export async function POST() {
  const session = await getSession();
  session.destroy();
  return NextResponse.redirect(new URL("/m/login", process.env.PUBLIC_BASE_URL ?? "http://localhost:3000"));
}
