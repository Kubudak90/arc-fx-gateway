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

beforeEach(() => { vi.clearAllMocks(); });

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
      { "X-Arc-Api-Key": "ak_live_bad" }
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
      { "X-Arc-Api-Key": "ak_live_good" }
    ));
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.invoiceId).toMatch(/^0x[0-9a-f]{64}$/);
    expect(body.url).toContain(body.invoiceId);
    expect(writeContract).toHaveBeenCalled();
  });
});
