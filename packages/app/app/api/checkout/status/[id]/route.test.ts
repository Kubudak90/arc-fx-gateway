import { describe, it, expect, vi, beforeEach } from "vitest";

// Must be a valid v4 UUID — the route rejects non-v4 ids with 404 before any DB
// lookup (UUID_RE guard in route.ts). Group 3 starts with 4, group 4 with 8/9/a/b.
const SUBMISSION_ID = "11111111-2222-4333-8444-555555555555";
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
  // 2026-07-05: a single select — the token lives on the relayer_queue row now,
  // so there is no second invoice lookup.
  builder.limit.mockImplementation(async () => queueRows);
  return { db: builder };
});

vi.mock("drizzle-orm", () => ({
  eq: (a: any, b: any) => ({ a, b }),
}));

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

const VALID_TOKEN = "valid-token-".padEnd(48, "0");
// The submission row carries its own token now (was on the invoice).
const tokenedRow = {
  ...baseRow,
  statusToken: VALID_TOKEN,
  statusTokenExpiresAt: new Date(Date.now() + 30 * 60_000),
};

beforeEach(() => {
  queueRows = [];
});

function call(qs = "", headers: Record<string, string> = {}) {
  // Build a NextRequest-shape stub. We use Request + spy on nextUrl.searchParams.
  const url = `http://localhost/api/checkout/status/${SUBMISSION_ID}${qs}`;
  const req: any = new Request(url, { headers });
  // Simulate Next's NextRequest.nextUrl.
  Object.defineProperty(req, "nextUrl", {
    value: new URL(url),
    configurable: true,
  });
  return GET(req as never, { params: Promise.resolve({ id: SUBMISSION_ID }) });
}

describe("GET /api/checkout/status/[id]", () => {
  it("returns 404 for unknown submission", async () => {
    const res = await call();
    expect(res.status).toBe(404);
  });

  it("WITHOUT token: returns ONLY { status } (M12 minimum)", async () => {
    queueRows = [baseRow];
    const res = await call();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.status).toBe("settled");
    // No detail leak — no tx hashes, no error string, no timestamps.
    expect(body.swapTxHash).toBeUndefined();
    expect(body.settleTxHash).toBeUndefined();
    expect(body.error).toBeUndefined();
    expect(body.invoiceId).toBeUndefined();
  });

  it("WITH valid token: returns full detail (settled state, both tx hashes)", async () => {
    queueRows = [tokenedRow];
    const res = await call("", { "x-status-token": VALID_TOKEN });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.status).toBe("settled");
    expect(body.swapTxHash).toBe("0xswap");
    expect(body.settleTxHash).toBe("0xsettle");
    expect(body.error).toBeNull();
  });

  it("WITH valid token via header: surfaces lastError only when status is failed", async () => {
    queueRows = [{ ...tokenedRow, status: "failed", lastError: "kit.swap timed out" }];
    const res = await call("", { "x-status-token": VALID_TOKEN });
    expect((await res.json()).error).toBe("kit.swap timed out");
  });

  it("WITH valid token: hides lastError on transient processing rows", async () => {
    queueRows = [{ ...tokenedRow, status: "processing", lastError: "transient rpc blip" }];
    const res = await call("", { "x-status-token": VALID_TOKEN });
    expect((await res.json()).error).toBeNull();
  });

  it("expired token treated as missing — falls back to bare status", async () => {
    queueRows = [{ ...baseRow, statusToken: VALID_TOKEN, statusTokenExpiresAt: new Date(Date.now() - 1000) }];
    const res = await call("", { "x-status-token": VALID_TOKEN });
    const body = await res.json();
    expect(body.status).toBe("settled");
    expect(body.swapTxHash).toBeUndefined();
  });

  it("wrong token rejected — falls back to bare status", async () => {
    queueRows = [tokenedRow];
    const res = await call("", { "x-status-token": "not-the-real-token" });
    const body = await res.json();
    expect(body.status).toBe("settled");
    expect(body.swapTxHash).toBeUndefined();
  });

  it("2026-07-05: a DIFFERENT submission's token can't unlock this row's detail", async () => {
    // Submission A's row carries token A. A second payer on the same invoice
    // holds their OWN token B; presenting B against A's submission id must NOT
    // reveal A's tx hashes — the token is bound to the row, not the invoice.
    queueRows = [{ ...baseRow, statusToken: "token-A-".padEnd(48, "0") }];
    const res = await call("", { "x-status-token": "token-B-".padEnd(48, "0") });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.status).toBe("settled");
    expect(body.swapTxHash).toBeUndefined();
    expect(body.error).toBeUndefined();
  });

  it("HIGH-4: a VALID token in the query string is IGNORED — bare status only", async () => {
    queueRows = [tokenedRow];
    const res = await call(`?token=${encodeURIComponent(VALID_TOKEN)}`);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.status).toBe("settled");
    // Detail must NOT unlock via the query channel (CWE-598: tokens in
    // query strings leak into access logs).
    expect(body.swapTxHash).toBeUndefined();
    expect(body.settleTxHash).toBeUndefined();
    expect(body.invoiceId).toBeUndefined();
    expect(body.error).toBeUndefined();
  });

  it("bare-status response is Cache-Control: no-store exactly (public endpoint, not private)", async () => {
    queueRows = [baseRow];
    const res = await call();
    expect(res.status).toBe(200);
    // Exactly `no-store` — NOT `no-store, private`. This endpoint is polled
    // anonymously; `private` would wrongly imply authenticated data.
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});
