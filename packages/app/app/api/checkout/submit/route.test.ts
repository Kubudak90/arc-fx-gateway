import { describe, it, expect, vi, beforeEach } from "vitest";
import { expectedWitnessHash } from "@/lib/checkout/witness";

const TEST_INVOICE_ID = "0x" + "ab".repeat(32);
const TEST_RELAYER = (process.env.NEXT_PUBLIC_RELAYER_ADDRESS ?? "0x9999999999999999999999999999999999999999") as `0x${string}`;
const TEST_WITNESS = expectedWitnessHash(TEST_INVOICE_ID as `0x${string}`, TEST_RELAYER);

const invoiceRow = {
  id:          TEST_INVOICE_ID,
  status:      "created",
  payInToken:  "0x3600000000000000000000000000000000000000",
  payoutToken: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a",
  amountOut:   "100000000",
  expiresAt:   new Date(Date.now() + 60 * 60_000),
};

const dbState: {
  invoiceRows: typeof invoiceRow[];
  queueDupRows: { id: string; status: string }[];
  insertedRows: unknown[];
  limitCalls: number;
} = {
  invoiceRows: [invoiceRow],
  queueDupRows: [],
  insertedRows: [],
  limitCalls: 0,
};

vi.mock("@/lib/db/client", () => {
  const builder = {
    select: vi.fn(),
    from:   vi.fn(),
    where:  vi.fn(),
    limit:  vi.fn(),
    insert: vi.fn(),
    values: vi.fn(),
    returning: vi.fn(),
  };
  builder.select.mockImplementation(() => builder);
  builder.from.mockImplementation(() => builder);
  builder.where.mockImplementation(() => builder);
  // First .limit() call → invoice rows. Second → queue dup rows.
  builder.limit.mockImplementation(async () => {
    dbState.limitCalls++;
    if (dbState.limitCalls === 1) return dbState.invoiceRows;
    return dbState.queueDupRows;
  });
  builder.insert.mockImplementation(() => builder);
  builder.values.mockImplementation((row: unknown) => {
    dbState.insertedRows.push(row);
    return builder;
  });
  builder.returning.mockImplementation(async () => [{ id: "11111111-2222-3333-4444-555555555555" }]);
  return { db: builder };
});

import { POST } from "./route";

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/checkout/submit", {
    method:  "POST",
    headers: { "content-type": "application/json" },
    body:    JSON.stringify(body),
  });
}

const validBody = () => ({
  invoiceId:        TEST_INVOICE_ID,
  payer:            "0x" + "11".repeat(20),
  payInToken:       "0x3600000000000000000000000000000000000000",
  amountIn:         "100000",
  permit2Data: {
    nonce:             "1",
    deadline:          String(Math.floor(Date.now() / 1000) + 600),
    witness:           TEST_WITNESS,
    witnessTypeString: "ArcoraSwapIntent witness)ArcoraSwapIntent(bytes32 invoiceId,address relayer)TokenPermissions(address token,uint256 amount)",
  },
  permit2Signature: "0x" + "ee".repeat(65),
});

beforeEach(() => {
  dbState.invoiceRows = [invoiceRow];
  dbState.queueDupRows = [];
  dbState.insertedRows = [];
  dbState.limitCalls = 0;
});

describe("POST /api/checkout/submit", () => {
  it("queues a valid submission", async () => {
    const res = await POST(makeRequest(validBody()) as never);
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.submissionId).toBe("11111111-2222-3333-4444-555555555555");
    expect(body.statusUrl).toContain("/api/checkout/status/");
    expect(dbState.insertedRows.length).toBe(1);
  });

  it("rejects malformed payloads", async () => {
    const res = await POST(makeRequest({ invoiceId: "not-hex" }) as never);
    expect(res.status).toBe(400);
  });

  it("rejects expired permits", async () => {
    const body = validBody();
    body.permit2Data.deadline = String(Math.floor(Date.now() / 1000) - 60);
    const res = await POST(makeRequest(body) as never);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("permit_expired");
  });

  it("rejects amountIn = 0", async () => {
    const body = validBody();
    body.amountIn = "0";
    const res = await POST(makeRequest(body) as never);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("amount_in_out_of_range");
  });

  it("rejects amountIn beyond sane upper bound", async () => {
    const body = validBody();
    body.amountIn = (10n ** 31n).toString();
    const res = await POST(makeRequest(body) as never);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("amount_in_out_of_range");
  });

  it("returns 404 for unknown invoice", async () => {
    dbState.invoiceRows = [];
    const res = await POST(makeRequest(validBody()) as never);
    expect(res.status).toBe(404);
  });

  it("returns 409 if invoice is already paid", async () => {
    dbState.invoiceRows = [{ ...invoiceRow, status: "paid" }];
    const res = await POST(makeRequest(validBody()) as never);
    expect(res.status).toBe(409);
    expect((await res.json()).status).toBe("paid");
  });

  it("returns 410 if invoice is past expiry", async () => {
    dbState.invoiceRows = [{ ...invoiceRow, expiresAt: new Date(Date.now() - 60_000) }];
    const res = await POST(makeRequest(validBody()) as never);
    expect(res.status).toBe(410);
  });

  it("rejects payInToken mismatch", async () => {
    const body = validBody();
    body.payInToken = "0x" + "22".repeat(20); // some other address
    const res = await POST(makeRequest(body) as never);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("pay_in_token_mismatch");
  });

  it("rejects witness hash that doesn't bind to (invoice, relayer)", async () => {
    const body = validBody();
    body.permit2Data.witness = "0x" + "00".repeat(32);
    const res = await POST(makeRequest(body) as never);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("witness_mismatch");
  });

  it("rejects duplicate submission while a non-failed queue row exists", async () => {
    dbState.queueDupRows = [{ id: "existing-sub", status: "pending" }];
    const res = await POST(makeRequest(validBody()) as never);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("duplicate_submission");
    expect(body.existingStatus).toBe("pending");
  });
});
