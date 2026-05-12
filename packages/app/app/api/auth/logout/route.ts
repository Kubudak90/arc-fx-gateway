import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";

export async function POST(req: NextRequest) {
  const publicBaseUrl = process.env.PUBLIC_BASE_URL;
  if (!publicBaseUrl) {
    // Fail closed — a localhost fallback in prod would redirect into oblivion
    // and (worse) trains the wrong default for any future use of this env.
    return NextResponse.json({ error: "public_base_url_unset" }, { status: 500 });
  }
  const expectedOrigin = new URL(publicBaseUrl).origin;

  // CSRF guard: a session-bound logout is still vulnerable to a cross-site
  // form POST that forcibly signs the merchant out mid-flow. Origin header
  // is set on all cross-site POSTs in modern browsers; Referer is the
  // older fallback.
  const origin  = req.headers.get("origin");
  const referer = req.headers.get("referer");
  let refererOrigin: string | null = null;
  if (referer) {
    try { refererOrigin = new URL(referer).origin; } catch { /* ignore */ }
  }
  const sameOrigin =
    origin === expectedOrigin ||
    refererOrigin === expectedOrigin;
  if (!sameOrigin) {
    return NextResponse.json({ error: "csrf" }, { status: 403 });
  }

  const session = await getSession();
  session.destroy();
  return NextResponse.redirect(new URL("/m/login", publicBaseUrl));
}
