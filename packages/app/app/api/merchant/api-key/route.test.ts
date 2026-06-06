import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth/session", () => ({ getSession: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ db: { update: vi.fn() } }));
vi.mock("@/lib/auth/apikey", () => ({
  generateApiKey: () => "ak_live_" + "R".repeat(56),
  hashApiKey: vi.fn().mockResolvedValue("$2a$10$hashhashhashhash"),
  PREFIX_LEN: 12,
}));

import { POST } from "./route";
import { NextRequest } from "next/server";

const SESSION = { merchantAddress: "0xabc0000000000000000000000000000000000000", save: vi.fn().mockResolvedValue(undefined) };

beforeEach(async () => {
  vi.clearAllMocks();
  const dbm = await import("@/lib/db/client");
  const returning = vi.fn().mockResolvedValue([{ address: SESSION.merchantAddress }]);
  const where = vi.fn().mockReturnValue({ returning });
  const set = vi.fn().mockReturnValue({ where });
  (dbm.db.update as any).mockReturnValue({ set });
  const session = await import("@/lib/auth/session");
  (session.getSession as any).mockResolvedValue({ ...SESSION });
});

function makeReq(headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/merchant/api-key", { method: "POST", headers });
}

describe("POST /api/merchant/api-key", () => {
  it("rotates the key and returns it (no Origin header → allowed)", async () => {
    const res = await POST(makeReq());
    expect(res.status).toBe(200);
    expect((await res.json()).apiKey).toMatch(/^ak_live_/);
  });

  it("rejects a cross-site Origin with 403 (AFG-006 CSRF)", async () => {
    const prev = process.env.PUBLIC_BASE_URL;
    process.env.PUBLIC_BASE_URL = "https://app.arcorapay.xyz";
    try {
      const res = await POST(makeReq({ origin: "https://evil.example.com" }));
      expect(res.status).toBe(403);
      expect((await res.json()).error).toBe("csrf");
    } finally {
      if (prev === undefined) delete process.env.PUBLIC_BASE_URL;
      else process.env.PUBLIC_BASE_URL = prev;
    }
  });

  it("returns 401 when there is no merchant session", async () => {
    const session = await import("@/lib/auth/session");
    (session.getSession as any).mockResolvedValue({ merchantAddress: undefined, save: vi.fn() });
    const res = await POST(makeReq());
    expect(res.status).toBe(401);
  });
});
