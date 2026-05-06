import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth/session", () => ({
  getSession: vi.fn(),
}));
vi.mock("@/lib/db/client", () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
  },
}));
vi.mock("@/lib/security/safeUrl", () => ({
  assertSafePublicUrl: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/auth/apikey", () => ({
  generateApiKey: () => "ak_live_AAAABBBBCCCC1111111111",
  hashApiKey: vi.fn().mockResolvedValue("$2a$10$hashhashhashhash"),
  PREFIX_LEN: 12,
}));
vi.mock("@/lib/crypto/secret", () => ({
  encrypt: () => ({ iv: Buffer.from("iv"), ciphertext: Buffer.from("ct") }),
}));

import { POST } from "./route";

function makeReq(body: unknown) {
  return new Request("http://localhost/api/merchant/bootstrap", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
}

const SESSION_BASE = {
  merchantAddress: "0xabc",
  apiKey: undefined as string | undefined,
  save: vi.fn().mockResolvedValue(undefined),
};

beforeEach(() => {
  vi.clearAllMocks();
  // Default: no existing merchant row
  return import("@/lib/db/client").then((m) => {
    (m.db.select as any).mockReturnValue({
      from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }),
    });
    const valuesSpy = vi.fn().mockResolvedValue(undefined);
    (m.db.insert as any).mockReturnValue({ values: valuesSpy });
    (m.db.insert as any)._valuesSpy = valuesSpy;
  }).then(() => import("@/lib/auth/session")).then((s) => {
    (s.getSession as any).mockResolvedValue({ ...SESSION_BASE });
  });
});

describe("POST /api/merchant/bootstrap allowed_origins", () => {
  it("rejects when allowedOrigins is missing", async () => {
    const res = await POST(makeReq({ payoutToken: "0x1111111111111111111111111111111111111111" }));
    expect(res.status).toBe(400);
  });

  it("rejects when allowedOrigins is empty array", async () => {
    const res = await POST(makeReq({
      payoutToken: "0x1111111111111111111111111111111111111111",
      allowedOrigins: [],
    }));
    expect(res.status).toBe(400);
  });

  it("rejects when allowedOrigins contains a non-URL string", async () => {
    const res = await POST(makeReq({
      payoutToken: "0x1111111111111111111111111111111111111111",
      allowedOrigins: ["not a url"],
    }));
    expect(res.status).toBe(400);
  });

  it("persists normalized origins (path stripped) on bootstrap", async () => {
    const dbm = await import("@/lib/db/client");
    const res = await POST(makeReq({
      payoutToken: "0x1111111111111111111111111111111111111111",
      allowedOrigins: ["https://shop.example.com/checkout/return", "https://staging.example.com"],
    }));
    expect(res.status).toBe(201);
    const valuesSpy = (dbm.db.insert as any)._valuesSpy as ReturnType<typeof vi.fn>;
    expect(valuesSpy).toHaveBeenCalled();
    const inserted = valuesSpy.mock.calls[0]![0];
    expect(inserted.allowedOrigins).toEqual([
      "https://shop.example.com",
      "https://staging.example.com",
    ]);
  });
});
