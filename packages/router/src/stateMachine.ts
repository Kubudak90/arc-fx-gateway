// Settlement state machine (PLAN §5.3). A pure reducer: given the current state,
// the escrow's path (A/B/C from selectRoute), and an event, return the next
// state — or throw on an illegal transition. Keeping it pure makes the lifecycle
// exhaustively table-testable and lets the orchestrator persist `{state}` after
// every step so it is crash-safe and resumable.

import type { SettlementPath } from "./selectRoute";

export type SettlementState =
  | "INVOICE_CREATED"
  | "AWAITING_DEPOSIT"
  | "DEPOSITED"
  // Path A
  | "SETTLING"
  | "SETTLED"
  // Path B/C cross-chain
  | "BURN_SENT"
  | "ATTESTATION_PENDING"
  | "RECEIVE_SENT"
  // Path B failure recovery
  | "PAYOUT_FAILED"
  | "RECOVERED_TO_BUYER"
  // Path C token settle
  | "SETTLED_FALLBACK_USDC"
  // refund / expiry (any path, pre-settlement)
  | "REFUND_REQUESTED"
  | "REFUNDED"
  | "EXPIRED";

export type SettlementEvent =
  | "DEPOSIT_PENDING" // invoice created → waiting for the buyer's deposit
  | "DEPOSIT_CONFIRMED"
  // Path A
  | "SETTLE_STARTED"
  | "SETTLE_CONFIRMED"
  // Path B/C
  | "BURN_CONFIRMED"
  | "ATTESTATION_REQUESTED"
  | "ATTESTATION_COMPLETE" // Iris returned `complete`; submit receiveMessage next
  | "RECEIVE_CONFIRMED" // receiveAndSettle landed (Path B paid, or Path C pending)
  // Path B failure
  | "HOOK_FAILED"
  | "RECOVER_CONFIRMED"
  // Path C deferred settle
  | "PATHC_SETTLE_CONFIRMED"
  | "PATHC_FALLBACK_CONFIRMED"
  // refund / expiry
  | "REFUND_REQUESTED"
  | "REFUND_CONFIRMED"
  | "EXPIRE";

export interface TransitionError extends Error {
  state: SettlementState;
  event: SettlementEvent;
  path: SettlementPath;
}

// Transitions shared by every path before the route diverges, plus the refund /
// expiry escapes that apply while funds are still escrowed (pre-settlement).
const COMMON: Partial<Record<SettlementState, Partial<Record<SettlementEvent, SettlementState>>>> = {
  INVOICE_CREATED: { DEPOSIT_PENDING: "AWAITING_DEPOSIT", EXPIRE: "EXPIRED" },
  AWAITING_DEPOSIT: { DEPOSIT_CONFIRMED: "DEPOSITED", EXPIRE: "EXPIRED" },
  // While DEPOSITED (USDC escrowed, before any settle dispatch) the buyer may refund.
  DEPOSITED: { REFUND_REQUESTED: "REFUND_REQUESTED" },
  REFUND_REQUESTED: { REFUND_CONFIRMED: "REFUNDED" },
};

// Per-path transitions out of DEPOSITED onward.
const BY_PATH: Record<SettlementPath, Partial<Record<SettlementState, Partial<Record<SettlementEvent, SettlementState>>>>> = {
  A: {
    DEPOSITED: { SETTLE_STARTED: "SETTLING", REFUND_REQUESTED: "REFUND_REQUESTED" },
    SETTLING: { SETTLE_CONFIRMED: "SETTLED" },
  },
  B: {
    DEPOSITED: { BURN_CONFIRMED: "BURN_SENT", REFUND_REQUESTED: "REFUND_REQUESTED" },
    BURN_SENT: { ATTESTATION_REQUESTED: "ATTESTATION_PENDING" },
    ATTESTATION_PENDING: { ATTESTATION_COMPLETE: "RECEIVE_SENT" },
    // receiveAndSettle either pays the merchant (SETTLED) or parks on hook failure.
    RECEIVE_SENT: { RECEIVE_CONFIRMED: "SETTLED", HOOK_FAILED: "PAYOUT_FAILED" },
    PAYOUT_FAILED: { RECOVER_CONFIRMED: "RECOVERED_TO_BUYER" },
  },
  C: {
    DEPOSITED: { BURN_CONFIRMED: "BURN_SENT", REFUND_REQUESTED: "REFUND_REQUESTED" },
    BURN_SENT: { ATTESTATION_REQUESTED: "ATTESTATION_PENDING" },
    ATTESTATION_PENDING: { ATTESTATION_COMPLETE: "RECEIVE_SENT" },
    // receiveAndSettle records pending; then a deferred settle (token or USDC fallback).
    RECEIVE_SENT: { PATHC_SETTLE_CONFIRMED: "SETTLED", PATHC_FALLBACK_CONFIRMED: "SETTLED_FALLBACK_USDC" },
  },
};

const TERMINAL: ReadonlySet<SettlementState> = new Set<SettlementState>([
  "SETTLED",
  "SETTLED_FALLBACK_USDC",
  "RECOVERED_TO_BUYER",
  "REFUNDED",
  "EXPIRED",
]);

export function isTerminal(state: SettlementState): boolean {
  return TERMINAL.has(state);
}

/** Apply `event` to `state` for an escrow on `path`. Throws on an illegal move. */
export function transition(path: SettlementPath, state: SettlementState, event: SettlementEvent): SettlementState {
  const next = BY_PATH[path][state]?.[event] ?? COMMON[state]?.[event];
  if (next === undefined) {
    const err = new Error(`illegal transition: path ${path}, state ${state}, event ${event}`) as TransitionError;
    err.state = state;
    err.event = event;
    err.path = path;
    throw err;
  }
  return next;
}

/** The starting state for a fresh invoice. */
export const INITIAL_STATE: SettlementState = "INVOICE_CREATED";
