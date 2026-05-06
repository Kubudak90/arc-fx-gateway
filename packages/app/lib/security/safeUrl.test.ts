import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { isPrivateAddress, assertSafePublicUrl, assertOriginAllowed } from "./safeUrl";

// Mock DNS so tests don't depend on network state.
vi.mock("node:dns/promises", () => {
  const lookup = vi.fn();
  return { default: { lookup }, lookup };
});

import dns from "node:dns/promises";

const lookupMock = dns.lookup as unknown as ReturnType<typeof vi.fn>;

const savedNodeEnv = process.env.NODE_ENV;

beforeEach(() => {
  lookupMock.mockReset();
});

afterEach(() => {
  if (savedNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = savedNodeEnv;
});

describe("isPrivateAddress", () => {
  it("flags RFC1918 ranges", () => {
    expect(isPrivateAddress("10.0.0.1")).toBe(true);
    expect(isPrivateAddress("172.16.0.1")).toBe(true);
    expect(isPrivateAddress("172.31.255.255")).toBe(true);
    expect(isPrivateAddress("192.168.1.1")).toBe(true);
  });

  it("flags loopback + link-local + cloud metadata", () => {
    expect(isPrivateAddress("127.0.0.1")).toBe(true);
    expect(isPrivateAddress("169.254.169.254")).toBe(true); // AWS metadata
  });

  it("flags carrier-grade NAT range", () => {
    expect(isPrivateAddress("100.64.0.1")).toBe(true);
    expect(isPrivateAddress("100.127.255.254")).toBe(true);
  });

  it("flags IPv6 loopback + link-local + ULA", () => {
    expect(isPrivateAddress("::1")).toBe(true);
    expect(isPrivateAddress("fe80::1")).toBe(true);
    expect(isPrivateAddress("fc00::1")).toBe(true);
    expect(isPrivateAddress("fd12:3456::1")).toBe(true);
  });

  it("flags IPv4-mapped IPv6 private addresses", () => {
    expect(isPrivateAddress("::ffff:10.0.0.1")).toBe(true);
    expect(isPrivateAddress("::ffff:127.0.0.1")).toBe(true);
  });

  it("passes public addresses", () => {
    expect(isPrivateAddress("8.8.8.8")).toBe(false);
    expect(isPrivateAddress("1.1.1.1")).toBe(false);
    expect(isPrivateAddress("2606:4700:4700::1111")).toBe(false);
  });
});

describe("assertSafePublicUrl", () => {
  it("rejects malformed URL", async () => {
    await expect(assertSafePublicUrl("not a url")).rejects.toThrow(/invalid_url/);
  });

  it("rejects unsupported schemes", async () => {
    await expect(assertSafePublicUrl("ftp://example.com")).rejects.toThrow(/unsupported_scheme/);
    await expect(assertSafePublicUrl("file:///etc/passwd")).rejects.toThrow(/unsupported_scheme/);
  });

  it("requires https in production", async () => {
    process.env.NODE_ENV = "production";
    await expect(assertSafePublicUrl("http://example.com/hook")).rejects.toThrow(/https_required/);
  });

  it("allows http in non-production", async () => {
    process.env.NODE_ENV = "development";
    lookupMock.mockResolvedValue([{ address: "8.8.8.8", family: 4 }]);
    await expect(assertSafePublicUrl("http://example.com/hook")).resolves.toBeUndefined();
  });

  it("rejects when DNS resolves to a private IP", async () => {
    lookupMock.mockResolvedValue([{ address: "10.0.0.5", family: 4 }]);
    await expect(assertSafePublicUrl("https://internal.example/hook"))
      .rejects.toThrow(/private_address_blocked/);
  });

  it("rejects when ANY resolved IP is private (DNS-rebind defense)", async () => {
    lookupMock.mockResolvedValue([
      { address: "8.8.8.8", family: 4 },
      { address: "169.254.169.254", family: 4 },
    ]);
    await expect(assertSafePublicUrl("https://hostile.example/hook"))
      .rejects.toThrow(/private_address_blocked/);
  });

  it("accepts a public URL with public DNS records", async () => {
    lookupMock.mockResolvedValue([{ address: "1.1.1.1", family: 4 }]);
    await expect(assertSafePublicUrl("https://merchant.example.com/webhook"))
      .resolves.toBeUndefined();
  });

  it("rejects when DNS lookup fails", async () => {
    lookupMock.mockRejectedValue(new Error("ENOTFOUND"));
    await expect(assertSafePublicUrl("https://nope.example/")).rejects.toThrow(/dns_lookup_failed/);
  });
});

describe("assertOriginAllowed", () => {
  it("accepts a URL whose origin matches the allowlist", () => {
    expect(() => assertOriginAllowed(
      "https://shop.example.com/checkout/success?x=1",
      ["https://shop.example.com"],
    )).not.toThrow();
  });

  it("rejects when origin is not in the allowlist", () => {
    expect(() => assertOriginAllowed(
      "https://attacker.example.com/?x=1",
      ["https://shop.example.com"],
    )).toThrow(/origin_not_allowed/);
  });

  it("treats different schemes as different origins", () => {
    // https://shop and http://shop differ — http NOT allowed unless declared.
    expect(() => assertOriginAllowed(
      "http://shop.example.com/ok",
      ["https://shop.example.com"],
    )).toThrow(/origin_not_allowed/);
  });

  it("treats different ports as different origins", () => {
    expect(() => assertOriginAllowed(
      "https://shop.example.com:8443/ok",
      ["https://shop.example.com"],
    )).toThrow(/origin_not_allowed/);
  });

  it("rejects malformed URLs with invalid_url", () => {
    expect(() => assertOriginAllowed(
      "not a url",
      ["https://shop.example.com"],
    )).toThrow(/invalid_url/);
  });

  it("rejects when allowlist is empty (no origins configured)", () => {
    expect(() => assertOriginAllowed(
      "https://shop.example.com/ok",
      [],
    )).toThrow(/origin_not_allowed/);
  });
});
