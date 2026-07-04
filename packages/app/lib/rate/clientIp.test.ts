import { describe, it, expect, afterEach } from "vitest";
import { clientIp } from "./clientIp";

function req(headers: Record<string, string>) {
  return { headers: new Headers(headers) } as never;
}

const savedTrust = process.env.TRUST_XFF_HOPS;
const savedVercel = process.env.VERCEL;
const savedRealIp = process.env.TRUST_REAL_IP;
afterEach(() => {
  if (savedTrust === undefined) delete process.env.TRUST_XFF_HOPS;
  else process.env.TRUST_XFF_HOPS = savedTrust;
  if (savedVercel === undefined) delete process.env.VERCEL;
  else process.env.VERCEL = savedVercel;
  if (savedRealIp === undefined) delete process.env.TRUST_REAL_IP;
  else process.env.TRUST_REAL_IP = savedRealIp;
});

describe("clientIp (L-4 trust boundary)", () => {
  it("prefers x-vercel-forwarded-for above everything else when on Vercel", () => {
    process.env.VERCEL = "1";
    expect(
      clientIp(req({
        "x-vercel-forwarded-for": "198.51.100.7",
        "x-real-ip": "1.1.1.1",
        "x-forwarded-for": "9.9.9.9, 198.51.100.7",
      })),
    ).toBe("198.51.100.7");
  });

  it("ignores a spoofed x-vercel-forwarded-for off Vercel (2026-07-04)", () => {
    delete process.env.VERCEL;
    expect(
      clientIp(req({
        "x-vercel-forwarded-for": "6.6.6.6",
        "x-forwarded-for": "9.9.9.9, 70.70.70.70",
      })),
    ).toBe("70.70.70.70");
  });

  it("uses x-real-ip on Vercel when no vercel header is present", () => {
    process.env.VERCEL = "1";
    expect(clientIp(req({ "x-real-ip": "203.0.113.9" }))).toBe("203.0.113.9");
  });

  it("ignores x-real-ip off Vercel unless TRUST_REAL_IP=1 (2026-07-04)", () => {
    delete process.env.VERCEL;
    expect(clientIp(req({ "x-real-ip": "203.0.113.9" }))).toBe("unknown");
    process.env.TRUST_REAL_IP = "1";
    expect(clientIp(req({ "x-real-ip": "203.0.113.9" }))).toBe("203.0.113.9");
  });

  it("takes the RIGHTMOST xff hop, never the spoofable leftmost", () => {
    expect(clientIp(req({ "x-forwarded-for": "1.2.3.4, 10.0.0.1, 70.70.70.70" })))
      .toBe("70.70.70.70");
  });

  it("honours TRUST_XFF_HOPS when more than one proxy is ours", () => {
    process.env.TRUST_XFF_HOPS = "2";
    // Two trailing hops were appended by our proxies; idx = len - trusted = 1,
    // i.e. the value the outer trusted proxy stamped. The leftmost
    // "55.55.55.55" is client-spoofed junk and is never selected.
    expect(clientIp(req({ "x-forwarded-for": "55.55.55.55, 10.0.0.1, 10.0.0.2" })))
      .toBe("10.0.0.1");
  });

  it("returns a single xff value unchanged", () => {
    expect(clientIp(req({ "x-forwarded-for": "88.88.88.88" }))).toBe("88.88.88.88");
  });

  it("falls back to 'unknown' when no client headers are present", () => {
    expect(clientIp(req({}))).toBe("unknown");
  });
});
