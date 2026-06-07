import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth/siwe", () => ({ verifySiweMessage: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getSession: vi.fn() }));

import { POST } from "./route";
import { NextRequest } from "next/server";

const ADDR = "0xabc0000000000000000000000000000000000000";

beforeEach(async () => {
  vi.clearAllMocks();
  const siwe = await import("@/lib/auth/siwe");
  (siwe.verifySiweMessage as any).mockResolvedValue({ address: ADDR });
  const session = await import("@/lib/auth/session");
  (session.getSession as any).mockResolvedValue({ merchantAddress: undefined, save: vi.fn().mockResolvedValue(undefined) });
});

function makeReq(headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/auth/siwe/verify", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ message: "siwe-msg", signature: "0xdeadbeef" }),
  });
}

describe("POST /api/auth/siwe/verify", () => {
  it("establishes the session on a same-origin (no Origin → allowed) valid message", async () => {
    const res = await POST(makeReq());
    expect(res.status).toBe(200);
    expect((await res.json()).address).toBe(ADDR);
  });

  it("rejects a cross-site Origin with 403 before verifying the message (AFG-006 login-CSRF)", async () => {
    const prev = process.env.PUBLIC_BASE_URL;
    process.env.PUBLIC_BASE_URL = "https://app.arcorapay.xyz";
    try {
      const res = await POST(makeReq({ origin: "https://evil.example.com" }));
      expect(res.status).toBe(403);
      expect((await res.json()).error).toBe("csrf");
      const siwe = await import("@/lib/auth/siwe");
      expect((siwe.verifySiweMessage as any)).not.toHaveBeenCalled();
    } finally {
      if (prev === undefined) delete process.env.PUBLIC_BASE_URL;
      else process.env.PUBLIC_BASE_URL = prev;
    }
  });
});
