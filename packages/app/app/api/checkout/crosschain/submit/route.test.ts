import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const takeTokenMock = vi.fn(async () => true);
vi.mock("@/lib/rate/limiter", () => ({ takeToken: (...args: any[]) => takeTokenMock(...args) }));

const verifyMock = vi.fn(async (): Promise<{ ok: true; blockNumber: bigint }> => ({
  ok: true,
  blockNumber: 123n,
}));
vi.mock("@/lib/crosschain/receipt", () => ({
  verifySourceBurnTx: (...args: any[]) => verifyMock(...(args as [])),
}));

const INTENT_ID = "11111111-1111-4111-8111-111111111111";

function baseRow() {
  return {
    id: INTENT_ID,
    invoiceId: "0x" + "1".repeat(64),
    payer: "0x" + "a".repeat(40),
    sourceChainId: 84532,
    sourceToken: "0x5555555555555555555555555555555555555555",
    sourceAmount: "5000000",
    destinationDomain: 30,
    mintRecipient: "0x" + "0".repeat(24) + "9".repeat(40),
    status: "authorized",
  };
}

const dbState = {
  row: baseRow() as any,
  updates: [] as any[],
  updateReturnsEmpty: false,
};

vi.mock("@/lib/db/client", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => (dbState.row ? [dbState.row] : []),
        }),
      }),
    }),
    update: () => ({
      set: (values: any) => ({
        where: () => ({
          returning: async () => {
            dbState.updates.push(values);
            return dbState.updateReturnsEmpty ? [] : [{ id: INTENT_ID }];
          },
        }),
      }),
    }),
    insert: () => ({
      values: async () => [],
    }),
  },
}));

function req(body: unknown) {
  return new Request("https://arcorapay.xyz/api/checkout/crosschain/submit", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.10" },
    body: JSON.stringify(body),
  }) as any;
}

const goodBody = {
  intentId: INTENT_ID,
  burnTxHash: "0x" + "b".repeat(64),
};

describe("POST /api/checkout/crosschain/submit", () => {
  beforeEach(() => {
    dbState.row = baseRow();
    dbState.updates = [];
    dbState.updateReturnsEmpty = false;
    takeTokenMock.mockReset().mockResolvedValue(true);
    verifyMock.mockReset().mockResolvedValue({ ok: true, blockNumber: 123n });
  });

  it("marks an authorized intent as bridge_pending after verified burn tx", async () => {
    const res = await POST(req(goodBody));
    const body = await res.json();

    expect(res.status).toBe(202);
    expect(body.status).toBe("bridge_pending");
    expect(dbState.updates[0].status).toBe("bridge_pending");
    expect(dbState.updates[0].burnTxHash).toBe("0x" + "b".repeat(64));
  });

  it("returns 400 with the verifier error and does not update the row when verification fails", async () => {
    verifyMock.mockRejectedValueOnce(new Error("burn_tx_wrong_amount"));

    const res = await POST(req(goodBody));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("burn_tx_wrong_amount");
    expect(dbState.updates).toHaveLength(0);
    expect(dbState.row.status).toBe("authorized");
  });

  it("returns 404 when the intent does not exist", async () => {
    dbState.row = null;

    const res = await POST(req(goodBody));
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe("intent_not_found");
  });

  it("returns 409 when the intent is already past authorized", async () => {
    dbState.row = { ...baseRow(), status: "bridge_pending" };

    const res = await POST(req(goodBody));
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toBe("intent_not_submittable");
    expect(dbState.updates).toHaveLength(0);
  });

  it("returns 409 when a concurrent submit wins the status race", async () => {
    dbState.updateReturnsEmpty = true;

    const res = await POST(req(goodBody));
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toBe("intent_not_submittable");
  });

  it("rate limits per IP", async () => {
    takeTokenMock.mockResolvedValueOnce(false);

    const res = await POST(req(goodBody));

    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("60");
    expect(dbState.updates).toHaveLength(0);
  });
});
