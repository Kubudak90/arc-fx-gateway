import { describe, it, expect, vi } from "vitest";
import { processRow, type Row, type ChainClient, type V2KeeperDeps } from "./v2-keeper";

// Domains in the test: 26 = escrow chain (Arc), 6 = payout chain (Base).
const ESC = 26;
const PAY = 6;

function cfg(domain: number) {
  return { contracts: { paymentEscrow: "0xPE", settlementReceiver: "0xSR" }, cctpDomain: domain, chainId: domain, name: `chain${domain}` } as unknown as ChainClient["cfg"];
}

function client(domain: number, reads: Record<string, unknown>): ChainClient {
  return {
    cfg: cfg(domain),
    pub: {
      readContract: vi.fn(async ({ functionName }: { functionName: string }) => reads[functionName]),
      waitForTransactionReceipt: vi.fn(async () => ({ status: "success" })),
    },
    wallet: { writeContract: vi.fn(async () => "0xTX") },
    refundWindow: undefined,
  } as unknown as ChainClient;
}

function deps(over: Partial<V2KeeperDeps> = {}): V2KeeperDeps & { pool: { query: ReturnType<typeof vi.fn> } } {
  return {
    pool: { query: vi.fn(async () => ({ rows: [], rowCount: 1 })) },
    account: {} as never,
    now: () => 2_000_000, // ms → 2000s, well past createdAt+window below
    log: () => {},
    getMessages: vi.fn(),
    ...over,
  } as never;
}

function row(over: Partial<Row> = {}): Row {
  return { invoice_ref: "0xREF", escrow_id: "0x011a" + "00".repeat(30) as `0x${string}`, path: null, escrow_domain: ESC, payout_domain: PAY, state: "DEPOSITED", burn_tx: null, ...over };
}

/** The state a setState() call wrote (params[1] of the UPDATE settlements query). */
function writtenStates(pool: { query: ReturnType<typeof vi.fn> }): string[] {
  return pool.query.mock.calls
    .filter((c) => typeof c[0] === "string" && c[0].includes("UPDATE settlements SET state"))
    .map((c) => (c[1] as unknown[])[1] as string);
}

const ESCROWED = ["0xpayer", "0xmerch", 1_000_000n, 1000n, ESC, 0, 1] as const; // status 1 = Escrowed, createdAt 1000

describe("keeper DEPOSITED → settle", () => {
  it("Path A (same chain) → SETTLED", async () => {
    const c = client(ESC, { REFUND_WINDOW: 120n, escrows: ESCROWED });
    const d = deps();
    await processRow(row({ escrow_domain: ESC, payout_domain: ESC }), new Map([[ESC, c]]), d, () => {});
    expect((c.wallet.writeContract as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
    expect(writtenStates(d.pool)).toContain("SETTLED");
  });

  it("Path B (cross chain) → BURN_SENT", async () => {
    const src = client(ESC, { REFUND_WINDOW: 120n, escrows: ESCROWED });
    const dst = client(PAY, {});
    const d = deps();
    await processRow(row(), new Map([[ESC, src], [PAY, dst]]), d, () => {});
    expect(src.wallet.writeContract as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(1);
    expect(writtenStates(d.pool)).toContain("BURN_SENT");
  });

  it("does NOT settle while still in the refund window", async () => {
    const inWindow = ["0xp", "0xm", 1_000_000n, 1990n, ESC, 0, 1] as const; // createdAt 1990, now 2000 ≤ 1990+120
    const c = client(ESC, { REFUND_WINDOW: 120n, escrows: inWindow });
    const d = deps();
    await processRow(row({ escrow_domain: ESC, payout_domain: ESC }), new Map([[ESC, c]]), d, () => {});
    expect(c.wallet.writeContract as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  });

  it("skips an escrow that is no longer Escrowed", async () => {
    const settledAlready = ["0xp", "0xm", 1_000_000n, 1000n, ESC, 0, 2] as const; // status 2 = Settled
    const c = client(ESC, { REFUND_WINDOW: 120n, escrows: settledAlready });
    const d = deps();
    await processRow(row({ escrow_domain: ESC, payout_domain: ESC }), new Map([[ESC, c]]), d, () => {});
    expect(c.wallet.writeContract as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  });
});

describe("keeper BURN_SENT → receiveAndSettle", () => {
  const attested = vi.fn(async () => [{ message: "0xMSG", attestation: "0xSIG", status: "complete" }]);

  it("Path B healthy → SETTLED", async () => {
    const dst = client(PAY, { failedPayout: ["0x0", 0n], pending: ["0x0", 0, 0n, 0n] });
    const d = deps({ getMessages: attested as never });
    await processRow(row({ state: "BURN_SENT", burn_tx: "0xBURN" }), new Map([[ESC, client(ESC, {})], [PAY, dst]]), d, () => {});
    expect(dst.wallet.writeContract as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(1);
    expect(writtenStates(d.pool)).toContain("SETTLED");
  });

  it("Path B blacklisted merchant → PAYOUT_FAILED", async () => {
    const dst = client(PAY, { failedPayout: ["0xpayer", 990_000n], pending: ["0x0", 0, 0n, 0n] });
    const d = deps({ getMessages: attested as never });
    await processRow(row({ state: "BURN_SENT", burn_tx: "0xBURN" }), new Map([[ESC, client(ESC, {})], [PAY, dst]]), d, () => {});
    expect(writtenStates(d.pool)).toContain("PAYOUT_FAILED");
  });

  it("Path C token payout → RECEIVE_SENT (pending swap)", async () => {
    const dst = client(PAY, { failedPayout: ["0x0", 0n], pending: ["0xmerch", 1, 990_000n, 0n] });
    const d = deps({ getMessages: attested as never });
    await processRow(row({ state: "BURN_SENT", burn_tx: "0xBURN" }), new Map([[ESC, client(ESC, {})], [PAY, dst]]), d, () => {});
    expect(writtenStates(d.pool)).toContain("RECEIVE_SENT");
  });

  it("waits when the attestation is not ready", async () => {
    const dst = client(PAY, {});
    const notReady = vi.fn(async () => [{ message: "0x", attestation: "PENDING", status: "pending_confirmations" }]);
    const d = deps({ getMessages: notReady as never });
    await processRow(row({ state: "BURN_SENT", burn_tx: "0xBURN" }), new Map([[ESC, client(ESC, {})], [PAY, dst]]), d, () => {});
    expect(dst.wallet.writeContract as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  });
});

describe("keeper recovery + fallback", () => {
  it("PAYOUT_FAILED → recoverToBuyer → RECOVERED_TO_BUYER + invoice refunded", async () => {
    const dst = client(PAY, {});
    const d = deps();
    await processRow(row({ state: "PAYOUT_FAILED" }), new Map([[ESC, client(ESC, {})], [PAY, dst]]), d, () => {});
    expect(dst.wallet.writeContract as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(1);
    expect(writtenStates(d.pool)).toContain("RECOVERED_TO_BUYER");
    expect(d.pool.query.mock.calls.some((c) => String(c[0]).toLowerCase().includes("update invoices set status='refunded'"))).toBe(true);
  });

  it("Path C RECEIVE_SENT → USDC fallback → SETTLED_FALLBACK_USDC", async () => {
    const dst = client(PAY, {});
    const d = deps();
    await processRow(row({ state: "RECEIVE_SENT" }), new Map([[ESC, client(ESC, {})], [PAY, dst]]), d, () => {});
    expect(dst.wallet.writeContract as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(1);
    expect(writtenStates(d.pool)).toContain("SETTLED_FALLBACK_USDC");
  });
});
