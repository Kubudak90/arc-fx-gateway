import { describe, it, expect, vi, beforeEach } from "vitest";

// In-memory limiter that mirrors `takeToken` semantics so the route under
// test exercises real 429 behaviour on the 11th call.
let counts = new Map<string, number>();

vi.mock("@/lib/rate/limiter", () => ({
  takeToken: vi.fn(async (bucket: string, limit: number) => {
    const next = (counts.get(bucket) ?? 0) + 1;
    counts.set(bucket, next);
    return next <= limit;
  }),
}));

vi.mock("@/lib/auth/siwe", () => ({
  generateNonce: vi.fn(async () => "deadbeef"),
}));

import { POST } from "./route";

beforeEach(() => {
  counts = new Map();
});

function reqFromIp(ip: string) {
  return new Request("http://localhost/api/auth/siwe/nonce", {
    method: "POST",
    headers: { "x-forwarded-for": ip },
  }) as never;
}

describe("POST /api/auth/siwe/nonce — rate limit (M9)", () => {
  it("allows the first 10 requests from one IP", async () => {
    for (let i = 0; i < 10; i++) {
      const res = await POST(reqFromIp("1.2.3.4"));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.nonce).toBe("deadbeef");
    }
  });

  it("returns 429 on the 11th request from the same IP within the window", async () => {
    for (let i = 0; i < 10; i++) {
      await POST(reqFromIp("1.2.3.4"));
    }
    const res = await POST(reqFromIp("1.2.3.4"));
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toBe("rate_limited");
    expect(res.headers.get("retry-after")).toBe("60");
  });

  it("a different IP isn't rate-limited by another IP's burst", async () => {
    for (let i = 0; i < 10; i++) {
      await POST(reqFromIp("1.2.3.4"));
    }
    // 4.3.2.1 still has its full budget.
    const res = await POST(reqFromIp("4.3.2.1"));
    expect(res.status).toBe(200);
  });

  it("uses the first IP in x-forwarded-for when there are multiple hops", async () => {
    const req = new Request("http://localhost/api/auth/siwe/nonce", {
      method: "POST",
      headers: { "x-forwarded-for": "203.0.113.5, 10.0.0.1, 10.0.0.2" },
    });
    const res = await POST(req as never);
    expect(res.status).toBe(200);
    expect(counts.get("siwe-nonce:203.0.113.5")).toBe(1);
  });

  it("falls back to x-real-ip when x-forwarded-for is missing", async () => {
    const req = new Request("http://localhost/api/auth/siwe/nonce", {
      method: "POST",
      headers: { "x-real-ip": "198.51.100.10" },
    });
    const res = await POST(req as never);
    expect(res.status).toBe(200);
    expect(counts.get("siwe-nonce:198.51.100.10")).toBe(1);
  });
});
