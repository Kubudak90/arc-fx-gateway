// packages/agent-commerce-cli/test/merchant-key.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveMerchantKey } from "../src/lib/merchant-key";

const RAW = "59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const KEY = `0x${RAW}` as const;
const OTHER = `0x${"a".repeat(64)}` as const;

const dirs: string[] = [];
function keyfileWith(contents: string): string {
  const d = mkdtempSync(join(tmpdir(), "mk-"));
  dirs.push(d);
  const p = join(d, "merchant.key");
  writeFileSync(p, contents);
  return p;
}
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe("resolveMerchantKey", () => {
  it("returns the env key when ARCORA_MERCHANT_KEY is set", () => {
    expect(resolveMerchantKey({ env: { ARCORA_MERCHANT_KEY: KEY }, keyfilePath: "/does/not/exist" })).toBe(KEY);
  });

  it("normalizes a bare (no 0x) env key", () => {
    expect(resolveMerchantKey({ env: { ARCORA_MERCHANT_KEY: RAW }, keyfilePath: "/does/not/exist" })).toBe(KEY);
  });

  it("prefers the env key over the keyfile (env wins)", () => {
    const path = keyfileWith(OTHER);
    expect(resolveMerchantKey({ env: { ARCORA_MERCHANT_KEY: KEY }, keyfilePath: path })).toBe(KEY);
  });

  it("falls back to the keyfile when no env key is set", () => {
    const path = keyfileWith(KEY);
    expect(resolveMerchantKey({ env: {}, keyfilePath: path })).toBe(KEY);
  });

  it("normalizes a keyfile that omits the 0x prefix and trims whitespace", () => {
    const path = keyfileWith(`${RAW}\n`);
    expect(resolveMerchantKey({ env: {}, keyfilePath: path })).toBe(KEY);
  });

  it("returns undefined when neither env nor keyfile is present", () => {
    expect(resolveMerchantKey({ env: {}, keyfilePath: "/does/not/exist" })).toBeUndefined();
  });

  it("ignores an empty env value and falls through to the keyfile", () => {
    const path = keyfileWith(KEY);
    expect(resolveMerchantKey({ env: { ARCORA_MERCHANT_KEY: "" }, keyfilePath: path })).toBe(KEY);
  });
});
