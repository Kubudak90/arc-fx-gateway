import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "./route";

vi.mock("@/lib/db/client", () => ({
  db: { select: vi.fn(), update: vi.fn() },
}));
vi.mock("@/lib/crypto/secret", () => ({
  decrypt: vi.fn().mockReturnValue("whsec_test"),
}));

global.fetch = vi.fn() as any;

function authReq() {
  return new Request("http://localhost/api/cron/dispatch-webhooks", {
    method: "POST",
    headers: { authorization: "Bearer secret" },
  }) as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = "secret";
});

describe("POST /api/cron/dispatch-webhooks", () => {
  it("rejects unauthorized", async () => {
    const res = await POST(new Request("http://localhost/api/cron/dispatch-webhooks", { method: "POST" }) as any);
    expect(res.status).toBe(401);
  });

  it("delivers a pending webhook and marks it succeeded", async () => {
    const dbMod = await import("@/lib/db/client");
    (dbMod.db.select as any).mockReturnValue({
      from: () => ({
        innerJoin: () => ({
          innerJoin: () => ({
            where: () => ({
              limit: () => Promise.resolve([
                {
                  id: "att-1",
                  invoiceId: "0x01",
                  url: "https://merchant/hook",
                  payload: { x: 1 },
                  attempts: 0,
                  enc: Buffer.alloc(48),
                  iv: Buffer.alloc(12),
                },
              ]),
            }),
          }),
        }),
      }),
    });
    (dbMod.db.update as any).mockReturnValue({ set: () => ({ where: () => Promise.resolve(undefined) }) });
    (global.fetch as any).mockResolvedValue(new Response("ok", { status: 200 }));

    const res = await POST(authReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.delivered).toBe(1);
    expect(global.fetch).toHaveBeenCalledWith(
      "https://merchant/hook",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "X-Arcora-Signature": expect.stringMatching(/^sha256=/) }),
      })
    );
  });
});
