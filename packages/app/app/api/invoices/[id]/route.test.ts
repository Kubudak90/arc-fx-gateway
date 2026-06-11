import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "./route";

vi.mock("@/lib/db/client", () => ({
  db: { select: vi.fn() },
}));

vi.mock("@/lib/auth/apikey", () => ({
  lookupMerchantByApiKey: vi.fn(),
}));

beforeEach(() => { vi.clearAllMocks(); });

function ctx(id: string) { return { params: Promise.resolve({ id }) }; }

function makeReq(opts: { apiKey?: string; legacyHeader?: boolean } = {}) {
  const headers: Record<string, string> = {};
  if (opts.apiKey) {
    // Canonical header is `x-arcora-api-key` (SDK + POST handler default).
    // `x-api-key` is the legacy alias kept for back-compat per audit #10.
    headers[opts.legacyHeader ? "x-api-key" : "x-arcora-api-key"] = opts.apiKey;
  }
  return new Request("http://localhost/api/invoices/0x01", { headers }) as any;
}

const MERCHANT_ID = "merchant-uuid-1";

/** Mocks the drizzle chain `select(...).from(...).innerJoin(...).where(...).limit(1)` */
function mockSelect(rows: unknown[]) {
  return import("@/lib/db/client").then((m) => {
    (m.db.select as any).mockReturnValue({
      from: () => ({
        innerJoin: () => ({
          where: () => ({ limit: () => Promise.resolve(rows) }),
        }),
      }),
    });
  });
}

const BASE_ROW = {
  id: "0x01", status: "created", amountOut: "100000",
  payInToken: "0xeurc", payoutToken: "0xusdc",
  expiresAt: new Date(),
  paidBy: "0xpayer", paidTx: "0xtx", paidAt: null,
  metadata: { orderId: "ORDER-42" },
  merchantId: MERCHANT_ID,
  allowedOrigins: ["https://shop.example.com"],
};

describe("GET /api/invoices/:id", () => {
  it("returns 404 for unknown invoice", async () => {
    await mockSelect([]);
    const res = await GET(makeReq(), ctx("0xnope"));
    expect(res.status).toBe(404);
  });

  it("public GET omits metadata, paidBy, paidTx (Audit L8)", async () => {
    await mockSelect([BASE_ROW]);
    const res = await GET(makeReq(), ctx("0x01"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.id).toBe("0x01");
    // Audit H1: client uses this for defense-in-depth before redirecting.
    expect(body.allowedOrigins).toEqual(["https://shop.example.com"]);
    // Audit L8: sensitive fields must be absent from public response.
    expect(body.metadata).toBeUndefined();
    expect(body.paidBy).toBeUndefined();
    expect(body.paidTx).toBeUndefined();
  });

  it("authenticated merchant GET includes metadata, paidBy, paidTx (Audit L8)", async () => {
    await mockSelect([BASE_ROW]);
    // Stub lookupMerchantByApiKey to return matching merchant.
    await import("@/lib/auth/apikey").then((m) => {
      (m.lookupMerchantByApiKey as any).mockResolvedValue({ id: MERCHANT_ID });
    });
    const res = await GET(makeReq({ apiKey: "ak_live_TEST" }), ctx("0x01"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.metadata).toEqual({ orderId: "ORDER-42" });
    expect(body.paidBy).toBe("0xpayer");
    expect(body.paidTx).toBe("0xtx");
  });

  it("wrong merchant API key still gets public shape only", async () => {
    await mockSelect([BASE_ROW]);
    await import("@/lib/auth/apikey").then((m) => {
      // Returns a different merchant.
      (m.lookupMerchantByApiKey as any).mockResolvedValue({ id: "other-merchant" });
    });
    const res = await GET(makeReq({ apiKey: "ak_live_OTHER" }), ctx("0x01"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.metadata).toBeUndefined();
  });

  it("legacy x-api-key header still authenticates (audit #10 back-compat)", async () => {
    await mockSelect([BASE_ROW]);
    await import("@/lib/auth/apikey").then((m) => {
      (m.lookupMerchantByApiKey as any).mockResolvedValue({ id: MERCHANT_ID });
    });
    const res = await GET(makeReq({ apiKey: "ak_live_TEST", legacyHeader: true }), ctx("0x01"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.metadata).toEqual({ orderId: "ORDER-42" });
  });
});

describe("GET /api/invoices/:id — cache hygiene (audit 2026-06-11 HIGH-3)", () => {
  it("marks the authenticated (API-key) response Cache-Control: no-store, private", async () => {
    await mockSelect([BASE_ROW]);
    await import("@/lib/auth/apikey").then((m) => {
      (m.lookupMerchantByApiKey as any).mockResolvedValue({ id: MERCHANT_ID });
    });
    const res = await GET(makeReq({ apiKey: "ak_live_TEST" }), ctx("0x01"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store, private");
  });
});
