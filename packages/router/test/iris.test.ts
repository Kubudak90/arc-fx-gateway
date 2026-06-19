import { describe, it, expect, vi } from "vitest";
import { getMessages, waitForAttestation } from "../src/iris";

const TX = "0xabc" as `0x${string}`;

function mockResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe("getMessages", () => {
  it("parses messages and lifts finalityThresholdExecuted", async () => {
    const fetchImpl = vi.fn(async () =>
      mockResponse({
        messages: [
          {
            message: "0xdead",
            eventNonce: "1",
            attestation: "0xsig",
            status: "complete",
            delayReason: null,
            decodedMessage: { finalityThresholdExecuted: 1000 },
          },
        ],
      }),
    ) as unknown as typeof fetch;

    const msgs = await getMessages(6, TX, { fetchImpl, testnet: true });
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.status).toBe("complete");
    expect(msgs[0]!.finalityThresholdExecuted).toBe(1000);
    expect(msgs[0]!.attestation).toBe("0xsig");
  });

  it("treats 404 (not yet indexed) as no messages", async () => {
    const fetchImpl = vi.fn(async () => mockResponse({}, 404)) as unknown as typeof fetch;
    expect(await getMessages(6, TX, { fetchImpl })).toEqual([]);
  });

  it("throws on a non-ok, non-404 status", async () => {
    const fetchImpl = vi.fn(async () => mockResponse({}, 500)) as unknown as typeof fetch;
    await expect(getMessages(6, TX, { fetchImpl })).rejects.toThrow(/iris_error:500/);
  });

  it("hits the testnet sandbox base + v2 path", async () => {
    const fetchImpl = vi.fn(async () => mockResponse({ messages: [] })) as unknown as typeof fetch;
    await getMessages(3, TX, { fetchImpl, testnet: true });
    expect(fetchImpl).toHaveBeenCalledWith(expect.stringContaining("iris-api-sandbox.circle.com/v2/messages/3"));
  });
});

describe("waitForAttestation", () => {
  it("polls until complete, then returns the attested message", async () => {
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call++;
      const status = call < 3 ? "pending_confirmations" : "complete";
      const attestation = call < 3 ? "PENDING" : "0xrealsig";
      return mockResponse({ messages: [{ message: "0xm", attestation, status, decodedMessage: {} }] });
    }) as unknown as typeof fetch;

    const m = await waitForAttestation(6, TX, { fetchImpl, pollMs: 0, sleep: async () => {} });
    expect(m.status).toBe("complete");
    expect(m.attestation).toBe("0xrealsig");
    expect(call).toBe(3);
  });

  it("times out after maxAttempts", async () => {
    const fetchImpl = vi.fn(async () =>
      mockResponse({ messages: [{ message: "0xm", attestation: "PENDING", status: "pending_confirmations", decodedMessage: {} }] }),
    ) as unknown as typeof fetch;
    await expect(
      waitForAttestation(6, TX, { fetchImpl, pollMs: 0, maxAttempts: 3, sleep: async () => {} }),
    ).rejects.toThrow(/iris_timeout/);
  });
});
