// Settlement orchestrator (PLAN §5.3). The crash-safe core: every settlement is
// a persisted record keyed by its off-chain `invoiceRef`, and EVERY state change
// goes through `advance` which transitions the state machine and persists before
// returning. Because the full state — including the burn tx hash needed to resume
// attestation polling — lives in the Store, a fresh Orchestrator built on the
// same Store picks up exactly where a crashed one left off. The Store and all
// chain/network effects are injected, so the lifecycle is testable end to end.

import type { PayoutToken, SettlementPath } from "./selectRoute";
import { selectRoute } from "./selectRoute";
import {
  type SettlementState,
  type SettlementEvent,
  transition,
  isTerminal,
  INITIAL_STATE,
} from "./stateMachine";

export interface SettlementRecord {
  /** Off-chain logical invoice id (the routing-independent key). */
  invoiceRef: string;
  /** On-chain bytes32, set once the deposit lands. */
  escrowId?: `0x${string}`;
  path: SettlementPath;
  escrowDomain: number;
  payoutDomain: number;
  payoutToken: PayoutToken;
  /** Decimal string at the edge (parsed to bigint minor units when transacting). */
  amount: string;
  state: SettlementState;
  /** Persisted so attestation polling resumes across restarts (Path B/C). */
  burnTx?: `0x${string}`;
  updatedAt: number;
}

export interface Store {
  get(invoiceRef: string): Promise<SettlementRecord | undefined>;
  put(record: SettlementRecord): Promise<void>;
  list(): Promise<SettlementRecord[]>;
}

/** Default in-memory Store. Swap for a durable one (sqlite/file) in production —
 *  the Orchestrator only depends on this interface. */
export class MemoryStore implements Store {
  private readonly map = new Map<string, SettlementRecord>();

  async get(invoiceRef: string): Promise<SettlementRecord | undefined> {
    const r = this.map.get(invoiceRef);
    return r ? { ...r } : undefined;
  }

  async put(record: SettlementRecord): Promise<void> {
    this.map.set(record.invoiceRef, { ...record });
  }

  async list(): Promise<SettlementRecord[]> {
    return [...this.map.values()].map((r) => ({ ...r }));
  }
}

export interface CreateInput {
  invoiceRef: string;
  escrowDomain: number;
  payoutDomain: number;
  payoutToken: PayoutToken;
  amount: string;
}

export class Orchestrator {
  constructor(
    private readonly store: Store,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** Register a new invoice. Path is fixed up front from the route inputs. */
  async create(input: CreateInput): Promise<SettlementRecord> {
    const existing = await this.store.get(input.invoiceRef);
    if (existing) {
      // Idempotent ONLY for identical inputs — a repeat of the same invoiceRef with different
      // routing (amount/domains/token) is a conflict, not an idempotent replay. Silently returning
      // the old record would settle against stale routing.
      if (
        existing.escrowDomain !== input.escrowDomain ||
        existing.payoutDomain !== input.payoutDomain ||
        existing.payoutToken !== input.payoutToken ||
        existing.amount !== input.amount
      ) {
        throw new Error(`invoice_conflict:${input.invoiceRef}`);
      }
      return existing;
    }
    const path = selectRoute({
      escrowDomain: input.escrowDomain,
      payoutDomain: input.payoutDomain,
      payoutToken: input.payoutToken,
    });
    const record: SettlementRecord = {
      invoiceRef: input.invoiceRef,
      path,
      escrowDomain: input.escrowDomain,
      payoutDomain: input.payoutDomain,
      payoutToken: input.payoutToken,
      amount: input.amount,
      state: INITIAL_STATE,
      updatedAt: this.now(),
    };
    await this.store.put(record);
    return record;
  }

  /** Apply an event, persisting the new state. Optionally patch fields (e.g. set
   *  `escrowId` on deposit, `burnTx` on burn) atomically with the transition. */
  async advance(
    invoiceRef: string,
    event: SettlementEvent,
    patch: Partial<Pick<SettlementRecord, "escrowId" | "burnTx">> = {},
  ): Promise<SettlementRecord> {
    const r = await this.store.get(invoiceRef);
    if (!r) throw new Error(`unknown_invoice:${invoiceRef}`);
    const next: SettlementRecord = {
      ...r,
      ...patch,
      state: transition(r.path, r.state, event),
      updatedAt: this.now(),
    };
    await this.store.put(next);
    return next;
  }

  get(invoiceRef: string): Promise<SettlementRecord | undefined> {
    return this.store.get(invoiceRef);
  }

  /** All settlements not yet in a terminal state — what a resumed router must
   *  pick back up (poll attestations, retry receive/settle, etc.). */
  async pending(): Promise<SettlementRecord[]> {
    const all = await this.store.list();
    return all.filter((r) => !isTerminal(r.state));
  }
}

export { isTerminal } from "./stateMachine";
export type { SettlementState };
