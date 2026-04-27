import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "./route";

vi.mock("@/lib/chain/client", () => ({
  publicClient: { getBlockNumber: vi.fn(), getLogs: vi.fn() },
  GATEWAY: "0xgw",
}));
vi.mock("@/lib/db/client", () => ({
  db: { select: vi.fn(), insert: vi.fn(), update: vi.fn() },
}));

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = "secret";
});

function authReq() {
  return new Request("http://localhost/api/cron/index-events", {
    method: "POST",
    headers: { authorization: "Bearer secret" },
  }) as any;
}

describe("POST /api/cron/index-events", () => {
  it("rejects unauthorized", async () => {
    const res = await POST(new Request("http://localhost/api/cron/index-events", { method: "POST" }) as any);
    expect(res.status).toBe(401);
  });

  it("scans new blocks and updates indexer state", async () => {
    const chain = await import("@/lib/chain/client");
    (chain.publicClient.getBlockNumber as any).mockResolvedValue(1000n);
    (chain.publicClient.getLogs as any).mockResolvedValue([]);

    const dbMod = await import("@/lib/db/client");
    (dbMod.db.select as any).mockReturnValue({
      from: () => ({ where: () => ({ limit: () => Promise.resolve([{ key: "last_processed_block", value: "990" }]) }) }),
    });
    (dbMod.db.update as any).mockReturnValue({ set: () => ({ where: () => Promise.resolve(undefined) }) });

    const res = await POST(authReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.from).toBe(991);
    expect(body.to).toBe(995); // 1000 - 5 reorg buffer
  });
});
