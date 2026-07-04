// packages/agent-commerce-cli/test/wallet.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveWallet } from "../src/lib/wallet";

const dirs: string[] = [];
function tmp() { const d = mkdtempSync(join(tmpdir(), "acc-")); dirs.push(d); return join(d, "merchant.key"); }
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d.replace(/\/merchant\.key$/, ""), { recursive: true, force: true }); });

describe("resolveWallet", () => {
  it("imports a provided key without writing a keyfile", () => {
    const path = tmp();
    const w = resolveWallet({ keyfilePath: path, importKey: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" });
    expect(w.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(w.created).toBe(false);
    expect(existsSync(path)).toBe(false);
  });
  it("generates and persists a fresh key, then loads the same one next time", () => {
    const path = tmp();
    const first = resolveWallet({ keyfilePath: path });
    expect(first.created).toBe(true);
    expect(existsSync(path)).toBe(true);
    const second = resolveWallet({ keyfilePath: path });
    expect(second.created).toBe(false);
    expect(second.address).toBe(first.address);
  });
});
