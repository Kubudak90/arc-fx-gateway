import { describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const INTENT_ID = "11111111-1111-4111-8111-111111111111";

const limitFn = vi.fn(async () => [
  {
    id: INTENT_ID,
    invoiceId: "0x" + "1".repeat(64),
    status: "bridge_pending",
    sourceChainId: 84532,
    burnTxHash: "0x" + "b".repeat(64),
    bridgeReceiveTxHash: null,
    arcSwapTxHash: null,
    settleTxHash: null,
    lastError: null,
    updatedAt: new Date("2026-06-08T12:00:00Z"),
  },
]);

vi.mock("@/lib/db/client", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: limitFn,
        }),
      }),
    }),
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: (a: any, b: any) => ({ a, b }),
}));

describe("GET /api/checkout/crosschain/status/[id]", () => {
  it("returns cross-chain payment status", async () => {
    const res = await GET(new Request("https://arcorapay.xyz") as any, {
      params: Promise.resolve({ id: INTENT_ID }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe("bridge_pending");
    expect(body.burnTxHash).toMatch(/^0x/);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("returns 404 for an unknown intent id", async () => {
    limitFn.mockResolvedValueOnce([]);

    const res = await GET(new Request("https://arcorapay.xyz") as any, {
      params: Promise.resolve({ id: "99999999-9999-4999-8999-999999999999" }),
    });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe("not_found");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("returns 404 and does not query db for an invalid (non-UUID) id", async () => {
    limitFn.mockClear();

    const res = await GET(new Request("https://arcorapay.xyz") as any, {
      params: Promise.resolve({ id: "not-a-uuid" }),
    });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe("not_found");
    expect(limitFn).not.toHaveBeenCalled();
  });

  it("exposes lastError only for failed states", async () => {
    limitFn.mockResolvedValueOnce([
      {
        id: "22222222-2222-4222-8222-222222222222",
        invoiceId: "0x" + "2".repeat(64),
        status: "bridge_failed",
        sourceChainId: 84532,
        burnTxHash: "0x" + "c".repeat(64),
        bridgeReceiveTxHash: null,
        arcSwapTxHash: null,
        settleTxHash: null,
        lastError: "CCTP_ATTESTATION_TIMEOUT",
        updatedAt: new Date("2026-06-08T13:00:00Z"),
      },
    ]);

    const res = await GET(new Request("https://arcorapay.xyz") as any, {
      params: Promise.resolve({ id: "22222222-2222-4222-8222-222222222222" }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.error).toBe("CCTP_ATTESTATION_TIMEOUT");
  });

  it("hides lastError on non-failed states", async () => {
    limitFn.mockResolvedValueOnce([
      {
        id: "33333333-3333-4333-8333-333333333333",
        invoiceId: "0x" + "3".repeat(64),
        status: "bridge_pending",
        sourceChainId: 84532,
        burnTxHash: "0x" + "d".repeat(64),
        bridgeReceiveTxHash: null,
        arcSwapTxHash: null,
        settleTxHash: null,
        lastError: "transient_rpc_error",
        updatedAt: new Date("2026-06-08T14:00:00Z"),
      },
    ]);

    const res = await GET(new Request("https://arcorapay.xyz") as any, {
      params: Promise.resolve({ id: "33333333-3333-4333-8333-333333333333" }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.error).toBeNull();
  });
});
