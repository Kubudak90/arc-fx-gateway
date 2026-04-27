import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "./route";

vi.mock("@/lib/db/client", () => ({
  db: { select: vi.fn() },
}));

beforeEach(() => { vi.clearAllMocks(); });

function ctx(id: string) { return { params: Promise.resolve({ id }) }; }

describe("GET /api/invoices/:id", () => {
  it("returns 404 for unknown invoice", async () => {
    const m = await import("@/lib/db/client");
    (m.db.select as any).mockReturnValue({
      from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }),
    });
    const res = await GET({} as any, ctx("0xnope"));
    expect(res.status).toBe(404);
  });

  it("returns invoice JSON for known id", async () => {
    const m = await import("@/lib/db/client");
    (m.db.select as any).mockReturnValue({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve([{
            id: "0x01", status: "created", amountOut: "100000",
            payInToken: "0xeurc", expiresAt: new Date(),
          }]),
        }),
      }),
    });
    const res = await GET({} as any, ctx("0x01"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.id).toBe("0x01");
    expect(body.status).toBe("created");
  });
});
