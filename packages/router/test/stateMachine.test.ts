import { describe, it, expect } from "vitest";
import {
  transition,
  isTerminal,
  INITIAL_STATE,
  type SettlementState,
  type SettlementEvent,
} from "../src/stateMachine";
import type { SettlementPath } from "../src/selectRoute";

function run(path: SettlementPath, events: SettlementEvent[], from: SettlementState = INITIAL_STATE): SettlementState {
  return events.reduce((s, e) => transition(path, s, e), from);
}

describe("happy-path lifecycles", () => {
  it("Path A: deposit → settle", () => {
    const end = run("A", ["DEPOSIT_PENDING", "DEPOSIT_CONFIRMED", "SETTLE_STARTED", "SETTLE_CONFIRMED"]);
    expect(end).toBe("SETTLED");
    expect(isTerminal(end)).toBe(true);
  });

  it("Path B: deposit → burn → attest → receive → settled", () => {
    const end = run("B", [
      "DEPOSIT_PENDING",
      "DEPOSIT_CONFIRMED",
      "BURN_CONFIRMED",
      "ATTESTATION_REQUESTED",
      "ATTESTATION_COMPLETE",
      "RECEIVE_CONFIRMED",
    ]);
    expect(end).toBe("SETTLED");
  });

  it("Path B failure: hook fails → recovered to buyer", () => {
    const end = run("B", [
      "DEPOSIT_PENDING",
      "DEPOSIT_CONFIRMED",
      "BURN_CONFIRMED",
      "ATTESTATION_REQUESTED",
      "ATTESTATION_COMPLETE",
      "HOOK_FAILED",
      "RECOVER_CONFIRMED",
    ]);
    expect(end).toBe("RECOVERED_TO_BUYER");
    expect(isTerminal(end)).toBe(true);
  });

  it("Path C: receive → token settle (valid events)", () => {
    const end = run("C", [
      "DEPOSIT_PENDING",
      "DEPOSIT_CONFIRMED",
      "BURN_CONFIRMED",
      "ATTESTATION_REQUESTED",
      "ATTESTATION_COMPLETE",
      "PATHC_SETTLE_CONFIRMED",
    ]);
    expect(end).toBe("SETTLED");
  });

  it("Path C fallback: no route → USDC fallback", () => {
    const end = run("C", [
      "DEPOSIT_PENDING",
      "DEPOSIT_CONFIRMED",
      "BURN_CONFIRMED",
      "ATTESTATION_REQUESTED",
      "ATTESTATION_COMPLETE",
      "PATHC_FALLBACK_CONFIRMED",
    ]);
    expect(end).toBe("SETTLED_FALLBACK_USDC");
  });
});

describe("refund + expiry escapes", () => {
  it("refund from DEPOSITED works on every path", () => {
    for (const path of ["A", "B", "C"] as SettlementPath[]) {
      const end = run(path, ["DEPOSIT_PENDING", "DEPOSIT_CONFIRMED", "REFUND_REQUESTED", "REFUND_CONFIRMED"]);
      expect(end).toBe("REFUNDED");
    }
  });

  it("expire before deposit", () => {
    expect(run("B", ["DEPOSIT_PENDING", "EXPIRE"])).toBe("EXPIRED");
    expect(run("A", ["EXPIRE"])).toBe("EXPIRED");
  });
});

describe("illegal transitions throw", () => {
  it("cannot receive before attestation (Path B)", () => {
    expect(() => transition("B", "DEPOSITED", "RECEIVE_CONFIRMED")).toThrow(/illegal transition/);
  });

  it("Path A has no burn", () => {
    expect(() => transition("A", "DEPOSITED", "BURN_CONFIRMED")).toThrow();
  });

  it("Path C cannot use the Path-B receive event", () => {
    expect(() => transition("C", "RECEIVE_SENT", "RECEIVE_CONFIRMED")).toThrow();
  });

  it("cannot refund after settled (terminal)", () => {
    expect(() => transition("A", "SETTLED", "REFUND_REQUESTED")).toThrow();
  });

  it("error carries context", () => {
    try {
      transition("A", "DEPOSITED", "BURN_CONFIRMED");
      expect.unreachable();
    } catch (e) {
      const err = e as { path: string; state: string; event: string };
      expect(err.path).toBe("A");
      expect(err.state).toBe("DEPOSITED");
      expect(err.event).toBe("BURN_CONFIRMED");
    }
  });
});

describe("terminal states", () => {
  it.each(["SETTLED", "SETTLED_FALLBACK_USDC", "RECOVERED_TO_BUYER", "REFUNDED", "EXPIRED"] as SettlementState[])(
    "%s is terminal",
    (s) => expect(isTerminal(s)).toBe(true),
  );
  it.each(["DEPOSITED", "BURN_SENT", "ATTESTATION_PENDING"] as SettlementState[])(
    "%s is not terminal",
    (s) => expect(isTerminal(s)).toBe(false),
  );
});
