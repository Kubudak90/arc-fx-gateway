import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "./route";

vi.mock("@/lib/auth/apikey", () => ({
  lookupMerchantByApiKey: vi.fn(),
}));
vi.mock("@/lib/chain/client", () => ({
  publicClient: { waitForTransactionReceipt: vi.fn().mockResolvedValue({ status: "success" }) },
  getServerWalletClient: vi.fn(),
  GATEWAY: "0xgw",
  POOL: "0xpool",
}));
vi.mock("@/lib/db/client", () => ({
  db: {
    insert: vi.fn(() => ({ values: vi.fn().mockResolvedValue(undefined) })),
  },
}));
vi.mock("@/lib/compliance/factory", () => ({
  resolveComplianceProvider: vi.fn(),
}));
vi.mock("@/lib/compliance/screen", () => ({
  screenWithAudit: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  // Default: compliance allows everything (matches Phase 0 / testnet behaviour).
  return import("@/lib/compliance/factory").then((f) => {
    (f.resolveComplianceProvider as any).mockReturnValue({ name: "noop" });
  }).then(() => import("@/lib/compliance/screen")).then((s) => {
    (s.screenWithAudit as any).mockResolvedValue({
      decision: "allow", risk: "low", ticketId: null, ttlSeconds: 86400,
      cachedAt: new Date(), reasons: [], providerSnapshot: {}, rowId: "r1", cached: false,
    });
  });
});

function makeReq(body: any, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/invoices", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  }) as any;
}

describe("POST /api/invoices", () => {
  it("rejects missing API key with 401", async () => {
    const res = await POST(makeReq({ amountUsdc: 1, payInToken: "EURC", successUrl: "https://x" }));
    expect(res.status).toBe(401);
  });

  it("rejects bad API key with 401", async () => {
    const m = await import("@/lib/auth/apikey");
    (m.lookupMerchantByApiKey as any).mockResolvedValue(null);
    const res = await POST(makeReq(
      { amountUsdc: 1, payInToken: "EURC", successUrl: "https://x" },
      { "X-Arcora-Api-Key": "ak_live_bad" }
    ));
    expect(res.status).toBe(401);
  });

  it("creates invoice when key valid + chain tx succeeds", async () => {
    const apikey = await import("@/lib/auth/apikey");
    (apikey.lookupMerchantByApiKey as any).mockResolvedValue({
      id: "00000000-0000-0000-0000-000000000001",
      address: "0x1111111111111111111111111111111111111111",
      payoutToken: "0x2222222222222222222222222222222222222222",
    });
    const chain = await import("@/lib/chain/client");
    const writeContract = vi.fn().mockResolvedValue("0xtxhash");
    (chain.getServerWalletClient as any).mockResolvedValue({ writeContract });

    const res = await POST(makeReq(
      { amountUsdc: 49.99, payInToken: "EURC", successUrl: "https://m/ok" },
      { "X-Arcora-Api-Key": "ak_live_good" }
    ));
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.invoiceId).toMatch(/^0x[0-9a-f]{64}$/);
    expect(body.url).toContain(body.invoiceId);
    expect(writeContract).toHaveBeenCalled();
  });

  it("blocks invoice creation with 403 when merchant payout is sanctioned", async () => {
    const apikey = await import("@/lib/auth/apikey");
    (apikey.lookupMerchantByApiKey as any).mockResolvedValue({
      id: "00000000-0000-0000-0000-000000000002",
      address: "0xb1ock",
      payoutToken: "0x2222222222222222222222222222222222222222",
    });
    const screen = await import("@/lib/compliance/screen");
    (screen.screenWithAudit as any).mockResolvedValue({
      decision: "reject", risk: "sanctions", ticketId: null,
      ttlSeconds: 3600, cachedAt: new Date(), reasons: ["OFAC: x"],
      providerSnapshot: {}, rowId: "r-sanc", cached: false,
    });
    const chain = await import("@/lib/chain/client");
    const writeContract = vi.fn();
    (chain.getServerWalletClient as any).mockResolvedValue({ writeContract });

    const res = await POST(makeReq(
      { amountUsdc: 10, payInToken: "USDC", successUrl: "https://m/ok" },
      { "X-Arcora-Api-Key": "ak_live_good" }
    ));
    const body = await res.json();
    expect(res.status).toBe(403);
    expect(body.code).toBe("MERCHANT_PAYOUT_BLOCKED");
    expect(writeContract).not.toHaveBeenCalled();
  });

  it("queues invoice with 202 when merchant payout is medium-risk", async () => {
    const apikey = await import("@/lib/auth/apikey");
    (apikey.lookupMerchantByApiKey as any).mockResolvedValue({
      id: "00000000-0000-0000-0000-000000000003",
      address: "0x1111111111111111111111111111111111111111",
      payoutToken: "0x2222222222222222222222222222222222222222",
    });
    const screen = await import("@/lib/compliance/screen");
    (screen.screenWithAudit as any).mockResolvedValue({
      decision: "review", risk: "medium", ticketId: "rev_xyz",
      ttlSeconds: 86400, cachedAt: new Date(), reasons: ["mid_exposure"],
      providerSnapshot: {}, rowId: "r-rev", cached: false,
    });
    const chain = await import("@/lib/chain/client");
    const writeContract = vi.fn();
    (chain.getServerWalletClient as any).mockResolvedValue({ writeContract });

    const res = await POST(makeReq(
      { amountUsdc: 10, payInToken: "USDC", successUrl: "https://m/ok" },
      { "X-Arcora-Api-Key": "ak_live_good" }
    ));
    const body = await res.json();
    expect(res.status).toBe(202);
    expect(body.status).toBe("queued");
    expect(body.ticketId).toBe("rev_xyz");
    expect(writeContract).not.toHaveBeenCalled();
  });
});
