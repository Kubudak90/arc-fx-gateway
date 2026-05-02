import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "./route";

vi.mock("@/lib/db/client", () => ({ db: {} }));

vi.mock("@/lib/compliance/factory", () => ({
  resolveComplianceProvider: vi.fn(),
}));

vi.mock("@/lib/compliance/screen", () => ({
  screenWithAudit: vi.fn(),
}));

vi.mock("drizzle-orm", () => ({
  and: (...args: any[]) => args,
  eq:  (a: any, b: any) => ({ a, b }),
  gt:  (a: any, b: any) => ({ a, b }),
  desc: (x: any) => x,
}));

const dbMod = await import("@/lib/db/client");
const factoryMod = await import("@/lib/compliance/factory");
const screenMod = await import("@/lib/compliance/screen");

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.COMPLIANCE_FAIL_OPEN_FOR_PAY;
  // Default: invoice + merchant rows exist; webhook insert is a no-op.
  // Tests that need different shapes override these directly.
  let selectCount = 0;
  (dbMod.db as any).select = () => ({
    from: () => ({
      where: () => ({
        limit: async () => {
          selectCount++;
          if (selectCount === 1) {
            return [{ id: "0x" + "a".repeat(64), status: "created", merchantId: "00000000-0000-0000-0000-000000000001" }];
          }
          return [{ webhookUrl: null }];
        },
      }),
    }),
  });
  (dbMod.db as any).insert = () => ({
    values: vi.fn().mockResolvedValue(undefined),
  });
});

const ADDR = "0x3687d36e8b0fee06bcd935b6312ca5b59f8e4317";
const INV = "0x" + "a".repeat(64);

function req(body: any) {
  return new Request("http://localhost/api/checkout/authorize", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
}

describe("POST /api/checkout/authorize", () => {
  it("allows when screen returns risk=low", async () => {
    (factoryMod.resolveComplianceProvider as any).mockReturnValue({ name: "noop" });
    (screenMod.screenWithAudit as any).mockResolvedValue({
      decision: "allow", risk: "low", ticketId: null, ttlSeconds: 86400,
      cachedAt: new Date(), reasons: [], providerSnapshot: {}, rowId: "r1", cached: false,
    });
    const res = await POST(req({ invoiceId: INV, address: ADDR }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.decision).toBe("allow");
    expect(body.ttlSeconds).toBe(86400);
  });

  it("returns review with ticketId on risk=medium", async () => {
    (factoryMod.resolveComplianceProvider as any).mockReturnValue({ name: "elliptic" });
    (screenMod.screenWithAudit as any).mockResolvedValue({
      decision: "review", risk: "medium", ticketId: "rev_abc",
      ttlSeconds: 86400, cachedAt: new Date(), reasons: ["mid_exposure"],
      providerSnapshot: {}, rowId: "r2", cached: false,
    });
    const res = await POST(req({ invoiceId: INV, address: ADDR }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.decision).toBe("review");
    expect(body.ticketId).toBe("rev_abc");
    // Customer-facing reason MUST NOT leak provider details
    expect(JSON.stringify(body)).not.toContain("mid_exposure");
  });

  it("returns reject on sanctions match without leaking provider reasoning", async () => {
    (factoryMod.resolveComplianceProvider as any).mockReturnValue({ name: "trmlabs" });
    (screenMod.screenWithAudit as any).mockResolvedValue({
      decision: "reject", risk: "sanctions", ticketId: null,
      ttlSeconds: 3600, cachedAt: new Date(),
      reasons: ["OFAC: tornado_cash"], providerSnapshot: {}, rowId: "r3", cached: false,
    });
    const res = await POST(req({ invoiceId: INV, address: ADDR }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.decision).toBe("reject");
    expect(body.code).toBe("SANCTIONED_WALLET");
    expect(JSON.stringify(body)).not.toContain("tornado_cash");
  });

  it("returns 404 when invoice does not exist", async () => {
    (dbMod.db as any).select = () => ({
      from: () => ({
        where: () => ({ limit: async () => [] }),
      }),
    });
    (factoryMod.resolveComplianceProvider as any).mockReturnValue({ name: "noop" });
    const res = await POST(req({ invoiceId: INV, address: ADDR }));
    expect(res.status).toBe(404);
  });

  it("enqueues compliance.review_queued webhook when merchant has webhookUrl", async () => {
    let selectCount = 0;
    (dbMod.db as any).select = () => ({
      from: () => ({
        where: () => ({
          limit: async () => {
            selectCount++;
            if (selectCount === 1) return [{ id: INV, status: "created", merchantId: "m-1" }];
            return [{ webhookUrl: "https://m.example/hook" }];
          },
        }),
      }),
    });
    const insertValues = vi.fn().mockResolvedValue(undefined);
    (dbMod.db as any).insert = () => ({ values: insertValues });

    (factoryMod.resolveComplianceProvider as any).mockReturnValue({ name: "elliptic" });
    (screenMod.screenWithAudit as any).mockResolvedValue({
      decision: "review", risk: "medium", ticketId: "rev_xyz",
      ttlSeconds: 86400, cachedAt: new Date(), reasons: [], providerSnapshot: {},
      rowId: "r-rev", cached: false,
    });

    const res = await POST(req({ invoiceId: INV, address: ADDR }));
    expect(res.status).toBe(200);
    expect(insertValues).toHaveBeenCalledTimes(1);
    const payload = insertValues.mock.calls[0]![0];
    expect(payload.url).toBe("https://m.example/hook");
    expect(payload.payload.type).toBe("compliance.review_queued");
    expect(payload.payload.ticket_id).toBe("rev_xyz");
  });

  it("rejects bad params with 400", async () => {
    const res = await POST(req({ invoiceId: "not-hex", address: "not-an-address" }));
    expect(res.status).toBe(400);
  });

  it("fails closed by default when provider throws on customer_pay", async () => {
    (factoryMod.resolveComplianceProvider as any).mockReturnValue({ name: "elliptic" });
    (screenMod.screenWithAudit as any).mockRejectedValue(new Error("provider_error: elliptic 503"));
    const res = await POST(req({ invoiceId: INV, address: ADDR }));
    const body = await res.json();
    expect(res.status).toBe(503);
    expect(body.decision).toBe("reject");
    expect(body.code).toBe("PROVIDER_UNAVAILABLE");
  });

  it("fails open when COMPLIANCE_FAIL_OPEN_FOR_PAY=true", async () => {
    process.env.COMPLIANCE_FAIL_OPEN_FOR_PAY = "true";
    (factoryMod.resolveComplianceProvider as any).mockReturnValue({ name: "elliptic" });
    (screenMod.screenWithAudit as any).mockRejectedValue(new Error("provider_error"));
    const res = await POST(req({ invoiceId: INV, address: ADDR }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.decision).toBe("allow");
    expect(body.providerDegraded).toBe(true);
  });
});
