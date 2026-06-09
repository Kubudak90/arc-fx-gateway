import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const takeTokenMock = vi.fn(async () => true);
vi.mock("@/lib/rate/limiter", () => ({ takeToken: (...args: any[]) => takeTokenMock(...args) }));

const dbState = {
  invoices: [{
    id: "0x" + "1".repeat(64),
    status: "created",
    payInToken: "0x3600000000000000000000000000000000000000",
    payoutToken: "0x3600000000000000000000000000000000000000",
    amountOut: "5000000",
    expiresAt: new Date(Date.now() + 30 * 60_000),
    merchantId: "merchant-1",
  }],
  crosschainRows: [] as any[],
  telemetryRows: [] as any[],
};

vi.mock("@/lib/db/client", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => dbState.invoices,
        }),
      }),
    }),
    insert: (table: any) => ({
      values: (row: any) => {
        const returning = async () => {
          if ("eventType" in row) {
            dbState.telemetryRows.push(row);
            return [{ id: "telemetry-1" }];
          }
          const inserted = { id: "11111111-1111-4111-8111-111111111111", ...row };
          dbState.crosschainRows.push(inserted);
          return [{ id: "11111111-1111-4111-8111-111111111111" }];
        };
        return {
          returning,
          onConflictDoUpdate: () => ({ returning }),
        };
      },
    }),
  },
}));

vi.mock("@/lib/compliance/factory", () => ({
  resolveComplianceProvider: () => ({ name: "noop" }),
}));

vi.mock("@/lib/compliance/screen", () => ({
  screenWithAudit: async () => ({ decision: "allow", risk: "low", reasons: [], ticketId: null }),
}));

function req(body: unknown) {
  return new Request("https://arcorapay.xyz/api/checkout/crosschain/prepare", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.10" },
    body: JSON.stringify(body),
  }) as any;
}

describe("POST /api/checkout/crosschain/prepare", () => {
  beforeEach(() => {
    dbState.crosschainRows = [];
    dbState.telemetryRows = [];
  });

  it("creates an authorized cross-chain intent for enabled Base Sepolia", async () => {
    const res = await POST(req({
      invoiceId: "0x" + "1".repeat(64),
      payer: "0x" + "a".repeat(40),
      sourceChainId: 84532,
    }));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.intentId).toBe("11111111-1111-4111-8111-111111111111");
    expect(body.sourceChain.chainId).toBe(84532);
    expect(body.depositForBurn.amount).toBe("5000000");
    expect(dbState.crosschainRows[0].status).toBe("authorized");
  });

  it("rejects disabled source chains", async () => {
    const res = await POST(req({
      invoiceId: "0x" + "1".repeat(64),
      payer: "0x" + "a".repeat(40),
      sourceChainId: 421614,
    }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("source_chain_disabled");
  });

  it("rate limits per IP", async () => {
    takeTokenMock.mockResolvedValueOnce(false);
    const res = await POST(req({
      invoiceId: "0x" + "1".repeat(64),
      payer: "0x" + "a".repeat(40),
      sourceChainId: 84532,
    }));
    expect(res.status).toBe(429);
  });
});
