import { describe, it, expect, vi, beforeEach } from "vitest";

const SUBMISSION_ID = "11111111-2222-3333-4444-555555555555";
let queueRows: unknown[] = [];

vi.mock("@/lib/db/client", () => {
  const builder = {
    select: vi.fn(),
    from:   vi.fn(),
    where:  vi.fn(),
    limit:  vi.fn(),
  };
  builder.select.mockImplementation(() => builder);
  builder.from.mockImplementation(() => builder);
  builder.where.mockImplementation(() => builder);
  builder.limit.mockImplementation(async () => queueRows);
  return { db: builder };
});

import { GET } from "./route";

const baseRow = {
  status:       "settled" as const,
  invoiceId:    "0x" + "ab".repeat(32),
  attempts:     1,
  swapTxHash:   "0xswap",
  settleTxHash: "0xsettle",
  refundTxHash: null,
  lastError:    null,
  createdAt:    new Date("2026-05-01T10:00:00Z"),
  updatedAt:    new Date("2026-05-01T10:00:05Z"),
};

beforeEach(() => { queueRows = []; });

function call() {
  return GET(
    new Request(`http://localhost/api/checkout/status/${SUBMISSION_ID}`) as never,
    { params: Promise.resolve({ id: SUBMISSION_ID }) },
  );
}

describe("GET /api/checkout/status/[id]", () => {
  it("returns 404 for unknown submission", async () => {
    const res = await call();
    expect(res.status).toBe(404);
  });

  it("returns settled state with both tx hashes", async () => {
    queueRows = [baseRow];
    const res = await call();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.status).toBe("settled");
    expect(body.swapTxHash).toBe("0xswap");
    expect(body.settleTxHash).toBe("0xsettle");
    expect(body.error).toBeNull();
  });

  it("surfaces lastError only when status is failed", async () => {
    queueRows = [{ ...baseRow, status: "failed", lastError: "kit.swap timed out" }];
    const res = await call();
    expect((await res.json()).error).toBe("kit.swap timed out");
  });

  it("hides lastError on transient processing rows", async () => {
    queueRows = [{ ...baseRow, status: "processing", lastError: "transient rpc blip" }];
    const res = await call();
    expect((await res.json()).error).toBeNull();
  });
});
