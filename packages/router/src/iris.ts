// CCTP V2 attestation (Iris) client (PLAN §5.3). After a burn we poll
//   GET {base}/v2/messages/{sourceDomain}?transactionHash={burnTx}
// until a message reports `status: "complete"`, at which point `attestation` is
// the real signature to hand to `receiveMessage`. Network access is injected so
// the polling logic is unit-testable, and polling is resumable: the only state
// needed to resume is (sourceDomain, burnTx), both persisted by the orchestrator.
//
// Response shape verified against
// developers.circle.com/api-reference/cctp/all/get-messages-v2.

import { IRIS_API } from "./chains";

export type IrisStatus = "complete" | "pending_confirmations";

export interface IrisMessage {
  /** Hex message bytes; `"0x"` placeholder until attested. */
  message: `0x${string}`;
  eventNonce: string;
  /** Real signature when `status === "complete"`; literal `"PENDING"` before. */
  attestation: `0x${string}` | "PENDING";
  status: IrisStatus;
  /** 1000 (fast/confirmed) or 2000 (finalized) once executed. */
  finalityThresholdExecuted?: number;
  /** Why a Fast transfer is being delayed (e.g. `insufficient_fee`), else null. */
  delayReason?: string | null;
}

export interface IrisOptions {
  /** Defaults to the sandbox/prod base by `testnet`. */
  base?: string;
  testnet?: boolean;
  fetchImpl?: typeof fetch;
}

function resolveBase(o: IrisOptions): string {
  return o.base ?? (o.testnet === false ? IRIS_API.mainnet : IRIS_API.testnet);
}

/** One fetch: all CCTP messages emitted by `burnTx` on `sourceDomain`. */
export async function getMessages(
  sourceDomain: number,
  burnTx: `0x${string}`,
  opts: IrisOptions = {},
): Promise<IrisMessage[]> {
  const f = opts.fetchImpl ?? fetch;
  const url = `${resolveBase(opts)}/v2/messages/${sourceDomain}?transactionHash=${burnTx}`;
  const res = await f(url);
  // 404 = Iris hasn't indexed the burn yet; treat as "no messages yet".
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`iris_error:${res.status}`);
  let json: { messages?: RawMessage[] };
  try {
    json = (await res.json()) as { messages?: RawMessage[] };
  } catch {
    throw new Error(`iris_parse_error:${res.status}`);
  }
  return (json.messages ?? []).map(normalize);
}

interface RawMessage {
  message: `0x${string}`;
  eventNonce?: string;
  attestation: `0x${string}` | "PENDING";
  status: IrisStatus;
  delayReason?: string | null;
  decodedMessage?: { finalityThresholdExecuted?: number };
}

function normalize(m: RawMessage): IrisMessage {
  return {
    message: m.message,
    eventNonce: m.eventNonce ?? "",
    attestation: m.attestation,
    status: m.status,
    finalityThresholdExecuted: m.decodedMessage?.finalityThresholdExecuted,
    delayReason: m.delayReason ?? null,
  };
}

export interface PollOptions extends IrisOptions {
  /** Which message from the burn tx to wait on (ascending log index). Default 0. */
  index?: number;
  /** Delay between polls, ms. Default 4000. */
  pollMs?: number;
  /** Give up after this many polls. Default 150 (~10 min at 4s). */
  maxAttempts?: number;
  /** Injected for tests; defaults to real setTimeout. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Poll until the target message is `complete`, then return it (with a real
 * attestation). Safe to call again after a crash — it re-derives everything from
 * (sourceDomain, burnTx).
 */
export async function waitForAttestation(
  sourceDomain: number,
  burnTx: `0x${string}`,
  opts: PollOptions = {},
): Promise<IrisMessage> {
  const index = opts.index ?? 0;
  const pollMs = opts.pollMs ?? 4000;
  const maxAttempts = opts.maxAttempts ?? 150;
  const sleep = opts.sleep ?? defaultSleep;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const messages = await getMessages(sourceDomain, burnTx, opts);
    const m = messages[index];
    if (m && m.status === "complete" && m.attestation !== "PENDING") return m;
    await sleep(pollMs);
  }
  throw new Error(`iris_timeout:${burnTx}:after_${maxAttempts}_attempts`);
}
