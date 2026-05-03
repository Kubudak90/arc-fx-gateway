import { NextResponse, type NextRequest } from "next/server";

const DOCS_HOST = "docs.arcorapay.xyz";

export function middleware(req: NextRequest) {
  const host = req.headers.get("host") ?? "";
  const url = req.nextUrl;

  // docs.arcorapay.xyz/* → arc-fx-gateway /docs/*
  // Subdomain rewrite so the hosted docs serve from a clean URL.
  if (host === DOCS_HOST && !url.pathname.startsWith("/docs")) {
    const target = url.clone();
    target.pathname = url.pathname === "/" ? "/docs" : `/docs${url.pathname}`;
    return NextResponse.rewrite(target);
  }

  // Existing behaviour: surface the requested pathname on /m/ routes so the
  // server layout can decide whether to redirect un-authed users to /m/login.
  const res = NextResponse.next();
  if (url.pathname.startsWith("/m/")) {
    res.headers.set("x-pathname", url.pathname);
  }
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
