import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth/session", () => ({
  getSession: vi.fn(),
}));
vi.mock("@/lib/db/client", () => ({
  db: {
    update: vi.fn(),
  },
}));
vi.mock("@/lib/security/safeUrl", () => ({
  assertSafePublicUrl: vi.fn().mockResolvedValue(undefined),
}));

import { PATCH } from "./route";

function makeReq(body: unknown) {
  return new NextRequest("http://localhost/api/merchant/origins", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

// NextRequest needs to be imported after vi.mock calls
import { NextRequest } from "next/server";

const SESSION_WITH_MERCHANT = {
  merchantAddress: "0xabc0000000000000000000000000000000000000",
};

const SESSION_NO_MERCHANT = {
  merchantAddress: undefined,
};

beforeEach(async () => {
  vi.clearAllMocks();

  // Default: update().set().where() chain resolves successfully
  const dbm = await import("@/lib/db/client");
  const whereSpy = vi.fn().mockResolvedValue(undefined);
  const setSpy = vi.fn().mockReturnValue({ where: whereSpy });
  (dbm.db.update as any).mockReturnValue({ set: setSpy });
  (dbm.db.update as any)._setSpy = setSpy;
  (dbm.db.update as any)._whereSpy = whereSpy;

  // Default: authenticated session
  const session = await import("@/lib/auth/session");
  (session.getSession as any).mockResolvedValue({ ...SESSION_WITH_MERCHANT });

  // Default: assertSafePublicUrl resolves
  const safeUrl = await import("@/lib/security/safeUrl");
  (safeUrl.assertSafePublicUrl as any).mockResolvedValue(undefined);
});

describe("PATCH /api/merchant/origins", () => {
  it("case 1: valid https origin → 200 with ok + allowedOrigins", async () => {
    const res = await PATCH(makeReq({ allowedOrigins: ["https://shop.example.com"] }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, allowedOrigins: ["https://shop.example.com"] });
  });

  it("case 2: http origin → 400 unsafe_origin (rejected before DNS)", async () => {
    const safeUrl = await import("@/lib/security/safeUrl");
    const res = await PATCH(makeReq({ allowedOrigins: ["http://shop.example.com"] }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("unsafe_origin");
    // assertSafePublicUrl must NOT be called — http rejected before DNS
    expect(safeUrl.assertSafePublicUrl).not.toHaveBeenCalled();
  });

  it("case 3: assertSafePublicUrl throws (private IP) → 400 unsafe_origin", async () => {
    const safeUrl = await import("@/lib/security/safeUrl");
    (safeUrl.assertSafePublicUrl as any).mockRejectedValueOnce(
      new Error("private_address_blocked:169.254.169.254"),
    );
    const res = await PATCH(makeReq({ allowedOrigins: ["https://169.254.169.254"] }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("unsafe_origin");
  });

  it("case 4: no session merchantAddress → 401", async () => {
    const session = await import("@/lib/auth/session");
    (session.getSession as any).mockResolvedValue({ ...SESSION_NO_MERCHANT });
    const res = await PATCH(makeReq({ allowedOrigins: ["https://shop.example.com"] }));
    expect(res.status).toBe(401);
  });
});
