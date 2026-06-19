import { describe, it, expect } from "vitest";
import { Orchestrator, MemoryStore, type SettlementRecord } from "../src/orchestrator";

let clock = 1_000;
const now = () => ++clock;

describe("Orchestrator lifecycle", () => {
  it("Path A: create → deposit → settle, persisting each step", async () => {
    const store = new MemoryStore();
    const o = new Orchestrator(store, now);

    await o.create({ invoiceRef: "inv-a", escrowDomain: 6, payoutDomain: 6, payoutToken: "USDC", amount: "10" });
    expect((await o.get("inv-a"))!.path).toBe("A");
    expect((await o.get("inv-a"))!.state).toBe("INVOICE_CREATED");

    await o.advance("inv-a", "DEPOSIT_PENDING");
    await o.advance("inv-a", "DEPOSIT_CONFIRMED", { escrowId: "0xdeadbeef" });
    expect((await o.get("inv-a"))!.escrowId).toBe("0xdeadbeef");

    await o.advance("inv-a", "SETTLE_STARTED");
    const done = await o.advance("inv-a", "SETTLE_CONFIRMED");
    expect(done.state).toBe("SETTLED");
    expect(await o.pending()).toHaveLength(0);
  });

  it("Path B failure → recovered, with burnTx persisted for resume", async () => {
    const store = new MemoryStore();
    const o = new Orchestrator(store, now);
    await o.create({ invoiceRef: "inv-b", escrowDomain: 6, payoutDomain: 3, payoutToken: "USDC", amount: "25" });
    expect((await o.get("inv-b"))!.path).toBe("B");

    await o.advance("inv-b", "DEPOSIT_PENDING");
    await o.advance("inv-b", "DEPOSIT_CONFIRMED", { escrowId: "0x01" });
    await o.advance("inv-b", "BURN_CONFIRMED", { burnTx: "0xburn" });
    expect((await o.get("inv-b"))!.burnTx).toBe("0xburn");

    await o.advance("inv-b", "ATTESTATION_REQUESTED");
    await o.advance("inv-b", "ATTESTATION_COMPLETE");
    await o.advance("inv-b", "HOOK_FAILED");
    const rec = await o.advance("inv-b", "RECOVER_CONFIRMED");
    expect(rec.state).toBe("RECOVERED_TO_BUYER");
  });

  it("Path C: cross-chain EURC settles via token", async () => {
    const store = new MemoryStore();
    const o = new Orchestrator(store, now);
    await o.create({ invoiceRef: "inv-c", escrowDomain: 6, payoutDomain: 3, payoutToken: "EURC", amount: "5" });
    expect((await o.get("inv-c"))!.path).toBe("C");

    for (const e of [
      "DEPOSIT_PENDING",
      "DEPOSIT_CONFIRMED",
      "BURN_CONFIRMED",
      "ATTESTATION_REQUESTED",
      "ATTESTATION_COMPLETE",
      "PATHC_SETTLE_CONFIRMED",
    ] as const) {
      await o.advance("inv-c", e);
    }
    expect((await o.get("inv-c"))!.state).toBe("SETTLED");
  });

  it("resumes after a crash: a new Orchestrator on the same Store continues", async () => {
    const store = new MemoryStore();
    const o1 = new Orchestrator(store, now);
    await o1.create({ invoiceRef: "inv-r", escrowDomain: 6, payoutDomain: 3, payoutToken: "USDC", amount: "12" });
    await o1.advance("inv-r", "DEPOSIT_PENDING");
    await o1.advance("inv-r", "DEPOSIT_CONFIRMED", { escrowId: "0xabc" });
    await o1.advance("inv-r", "BURN_CONFIRMED", { burnTx: "0xburnhash" });

    // --- "crash": drop o1, rebuild from the persisted Store ---
    const o2 = new Orchestrator(store, now);
    const resumed = (await o2.pending())[0]!;
    expect(resumed.invoiceRef).toBe("inv-r");
    expect(resumed.state).toBe("BURN_SENT");
    expect(resumed.burnTx).toBe("0xburnhash"); // enough to resume Iris polling
    expect(resumed.escrowId).toBe("0xabc");

    // continue from exactly where we left off
    await o2.advance("inv-r", "ATTESTATION_REQUESTED");
    await o2.advance("inv-r", "ATTESTATION_COMPLETE");
    const done = await o2.advance("inv-r", "RECEIVE_CONFIRMED");
    expect(done.state).toBe("SETTLED");
    expect(await o2.pending()).toHaveLength(0);
  });

  it("create is idempotent on invoiceRef", async () => {
    const store = new MemoryStore();
    const o = new Orchestrator(store, now);
    const a = await o.create({ invoiceRef: "dup", escrowDomain: 6, payoutDomain: 6, payoutToken: "USDC", amount: "1" });
    await o.advance("dup", "DEPOSIT_PENDING");
    const b = await o.create({ invoiceRef: "dup", escrowDomain: 6, payoutDomain: 6, payoutToken: "USDC", amount: "1" });
    expect(b.state).toBe("AWAITING_DEPOSIT"); // returns the existing, advanced record
    expect(a.invoiceRef).toBe(b.invoiceRef);
  });

  it("advance on an unknown invoice throws", async () => {
    const o = new Orchestrator(new MemoryStore(), now);
    await expect(o.advance("nope", "DEPOSIT_PENDING")).rejects.toThrow(/unknown_invoice/);
  });

  it("pending lists only non-terminal settlements", async () => {
    const store = new MemoryStore();
    const o = new Orchestrator(store, now);
    await o.create({ invoiceRef: "t1", escrowDomain: 6, payoutDomain: 6, payoutToken: "USDC", amount: "1" });
    await o.create({ invoiceRef: "t2", escrowDomain: 6, payoutDomain: 6, payoutToken: "USDC", amount: "1" });
    await o.advance("t1", "DEPOSIT_PENDING");
    await o.advance("t1", "DEPOSIT_CONFIRMED");
    await o.advance("t1", "SETTLE_STARTED");
    await o.advance("t1", "SETTLE_CONFIRMED"); // terminal
    const pending = await o.pending();
    expect(pending.map((r: SettlementRecord) => r.invoiceRef)).toEqual(["t2"]);
  });
});
