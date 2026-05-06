import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "./route";

vi.mock("@/lib/db/client", () => ({
  db: { select: vi.fn() },
}));

beforeEach(() => { vi.clearAllMocks(); });

function ctx(id: string) { return { params: Promise.resolve({ id }) }; }

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

describe("GET /api/invoices/:id", () => {
  it("returns 404 for unknown invoice", async () => {
    await mockSelect([]);
    const res = await GET({} as any, ctx("0xnope"));
    expect(res.status).toBe(404);
  });

  it("returns invoice JSON including allowedOrigins for known id", async () => {
    await mockSelect([{
      id: "0x01", status: "created", amountOut: "100000",
      payInToken: "0xeurc", expiresAt: new Date(),
      paidBy: null, paidTx: null, paidAt: null, metadata: null,
      allowedOrigins: ["https://shop.example.com"],
    }]);
    const res = await GET({} as any, ctx("0x01"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.id).toBe("0x01");
    expect(body.status).toBe("created");
    // Audit H1: client uses this for defense-in-depth before redirecting.
    expect(body.allowedOrigins).toEqual(["https://shop.example.com"]);
  });
});
