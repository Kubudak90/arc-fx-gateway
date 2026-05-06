import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth/session", () => ({
  getSession: vi.fn(),
}));

// Module-level result arrays — tests populate these before each scenario.
const merchantRows: any[] = [];
const pendingRows: any[] = [];
const maturedRows: any[] = [];
const claimedRows: any[] = [];

vi.mock("@/lib/db/client", () => {
  // The route executes these DB calls in order:
  //   1. select().from(merchants).where().limit(1)    → merchant row
  //   2. select().from(invoices).where()              → pending rows  (no limit)
  //   3. select().from(invoices).where()              → matured rows  (no limit)
  //   4. select().from(invoices).where().limit(50)    → claimed rows
  // Calls 2-4 are issued concurrently via Promise.all, but the mock resolves
  // them deterministically by counting .where() invocations.
  let callSeq = 0;
  (globalThis as any).__resetEscrowMock = () => { callSeq = 0; };

  const builder: any = {
    select: vi.fn().mockReturnThis(),
    from:   vi.fn().mockReturnThis(),
    where:  vi.fn(),
  };

  builder.where.mockImplementation(() => {
    callSeq++;
    const seq = callSeq;

    if (seq === 1) {
      // Merchant lookup → caller chains .limit(1)
      return { limit: (n: number) => Promise.resolve(merchantRows.slice(0, n)) };
    }
    if (seq === 2) {
      // Pending query — no limit, resolves as promise
      return Promise.resolve(pendingRows);
    }
    if (seq === 3) {
      // Matured query — no limit
      return Promise.resolve(maturedRows);
    }
    // Claimed query → caller chains .limit(50)
    return { limit: (n: number) => Promise.resolve(claimedRows.slice(0, n)) };
  });

  return { db: builder };
});

vi.mock("drizzle-orm", async () => {
  const actual = await vi.importActual<any>("drizzle-orm");
  return { ...actual };
});

import { GET } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  merchantRows.length = 0;
  pendingRows.length  = 0;
  maturedRows.length  = 0;
  claimedRows.length  = 0;
  merchantRows.push({ id: "merch-1", address: "0xMerchant", payoutToken: "0xUSDC" });
  (globalThis as any).__resetEscrowMock?.();
});

describe("GET /api/merchant/escrows", () => {
  it("returns 401 when unauthenticated", async () => {
    const { getSession } = await import("@/lib/auth/session");
    (getSession as any).mockResolvedValue({});
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("returns pending + matured + claimed groups for the authed merchant", async () => {
    const { getSession } = await import("@/lib/auth/session");
    (getSession as any).mockResolvedValue({ merchantAddress: "0xMerchant" });

    const now = new Date();
    const future = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const past   = new Date(now.getTime() - 1000);

    pendingRows.push({ id: "0xinv-pending", status: "paid",    claimableAt: future });
    maturedRows.push({ id: "0xinv-matured", status: "paid",    claimableAt: past });
    claimedRows.push({ id: "0xinv-claimed", status: "claimed", claimableAt: past });

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.counts.pending).toBe(1);
    expect(body.counts.matured).toBe(1);
    expect(body.counts.claimed).toBe(1);
    expect(body.pending[0].id).toBe("0xinv-pending");
    expect(body.matured[0].id).toBe("0xinv-matured");
    expect(body.claimed[0].id).toBe("0xinv-claimed");
  });
});
