import { describe, it, expect } from "vitest";
import { securityHeaders } from "./headers";

describe("securityHeaders (M14)", () => {
  it("returns an array of header objects", () => {
    const headers = securityHeaders();
    expect(Array.isArray(headers)).toBe(true);
    expect(headers.length).toBeGreaterThan(0);
    for (const h of headers) {
      expect(typeof h.key).toBe("string");
      expect(typeof h.value).toBe("string");
      expect(h.key.length).toBeGreaterThan(0);
      expect(h.value.length).toBeGreaterThan(0);
    }
  });

  it("includes X-Frame-Options", () => {
    const headers = securityHeaders();
    const h = headers.find((x) => x.key === "X-Frame-Options");
    expect(h).toBeDefined();
    expect(h!.value).toBe("SAMEORIGIN");
  });

  it("includes Strict-Transport-Security with long max-age", () => {
    const headers = securityHeaders();
    const h = headers.find((x) => x.key === "Strict-Transport-Security");
    expect(h).toBeDefined();
    expect(h!.value).toMatch(/max-age=\d+/);
    const match = h!.value.match(/max-age=(\d+)/);
    expect(Number(match![1])).toBeGreaterThanOrEqual(31536000); // at least 1 year
  });

  it("includes Content-Security-Policy", () => {
    const headers = securityHeaders();
    const h = headers.find((x) => x.key === "Content-Security-Policy");
    expect(h).toBeDefined();
    expect(h!.value).toMatch(/default-src/);
    expect(h!.value).toMatch(/script-src/);
  });

  it("includes X-Content-Type-Options: nosniff", () => {
    const headers = securityHeaders();
    const h = headers.find((x) => x.key === "X-Content-Type-Options");
    expect(h).toBeDefined();
    expect(h!.value).toBe("nosniff");
  });

  it("does not contain duplicate keys", () => {
    const headers = securityHeaders();
    const keys = headers.map((h) => h.key);
    const unique = new Set(keys);
    expect(unique.size).toBe(keys.length);
  });
});
