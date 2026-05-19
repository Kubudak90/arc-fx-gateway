import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth/session", () => ({
  getSession: vi.fn(),
}));
vi.mock("@/lib/db/client", () => ({
  db: {
    update: vi.fn(),
  },
}));
vi.mock("@/lib/crypto/secret", () => ({
  encrypt: vi.fn().mockReturnValue({ iv: "iv", ciphertext: "ct" }),
}));
vi.mock("@/lib/security/safeUrl", () => ({
  assertSafePublicUrl: vi.fn().mockResolvedValue(undefined),
}));

import { PATCH, POST } from "./route";
import { NextRequest } from "next/server";

const SESSION_WITH_MERCHANT = {
  merchantAddress: "0xabc0000000000000000000000000000000000000",
};

function makePatchReq(body: unknown) {
  return new NextRequest("http://localhost/api/merchant/webhook", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

function makePostReq() {
  return new NextRequest("http://localhost/api/merchant/webhook", {
    method: "POST",
  });
}

// Helper: set up db mock so update().set().where().returning() resolves to rows
async function setupDbMock(returningRows: unknown[]) {
  const dbm = await import("@/lib/db/client");
  const returningSpyFn = vi.fn().mockResolvedValue(returningRows);
  const whereSpy = vi.fn().mockReturnValue({ returning: returningSpyFn });
  const setSpy = vi.fn().mockReturnValue({ where: whereSpy });
  (dbm.db.update as any).mockReturnValue({ set: setSpy });
}

beforeEach(async () => {
  vi.clearAllMocks();

  // Default: authenticated session with merchant
  const session = await import("@/lib/auth/session");
  (session.getSession as any).mockResolvedValue({ ...SESSION_WITH_MERCHANT });

  // Default: merchant exists → .returning() resolves to [{ address: "0xabc..." }]
  await setupDbMock([{ address: SESSION_WITH_MERCHANT.merchantAddress }]);

  // Default: assertSafePublicUrl resolves
  const safeUrl = await import("@/lib/security/safeUrl");
  (safeUrl.assertSafePublicUrl as any).mockResolvedValue(undefined);
});

describe("PATCH /api/merchant/webhook", () => {
  it("merchant exists → 200 { ok: true }", async () => {
    const res = await PATCH(makePatchReq({ webhookUrl: "https://shop.example.com/hook" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
  });

  it("merchant missing (returning []) → 404 { error: 'no_merchant' }", async () => {
    await setupDbMock([]);
    const res = await PATCH(makePatchReq({ webhookUrl: "https://shop.example.com/hook" }));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ error: "no_merchant" });
  });
});

describe("POST /api/merchant/webhook", () => {
  it("merchant exists → 200 with webhookSecret in body", async () => {
    const res = await POST(makePostReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("webhookSecret");
    expect(typeof body.webhookSecret).toBe("string");
  });

  it("merchant missing (returning []) → 404 { error: 'no_merchant' }", async () => {
    await setupDbMock([]);
    const res = await POST(makePostReq());
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ error: "no_merchant" });
  });
});
