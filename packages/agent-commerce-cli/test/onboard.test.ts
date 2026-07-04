// packages/agent-commerce-cli/test/onboard.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { onboardMerchant, resolveRegisterPayoutAddress } from "../src/lib/onboard";

const ARC_CHAIN_ID = 5042002;
const DEFAULT_SWEEP = "0x29EcFedDF31E4dA4a62b89bADe35b224cE144DAE";

const account = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");

function fakeFetch() {
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/api/auth/siwe/nonce")) return new Response(JSON.stringify({ nonce: "abc123nonce" }), { status: 200 });
    if (url.endsWith("/api/auth/siwe/verify")) return new Response(JSON.stringify({ address: account.address }), { status: 200, headers: { "set-cookie": "arcora_session=xyz; Path=/; HttpOnly" } });
    if (url.endsWith("/api/merchant/bootstrap")) return new Response(JSON.stringify({ apiKey: "ak_live_TEST123", publishableKey: "pk_live_TEST" }), { status: 201 });
    if (url.endsWith("/api/merchant/payout-chain")) {
      const body = JSON.parse((init?.body as string) ?? "{}");
      return new Response(JSON.stringify({ ok: true, payoutChainId: body.payoutChainId, payoutChainAddress: body.payoutChainAddress ?? null }), { status: 200 });
    }
    return new Response("{}", { status: 404 });
  });
}

function fakeChain() {
  return {
    readContract: vi.fn().mockResolvedValue(["0x0000000000000000000000000000000000000000", "0x0000000000000000000000000000000000000000", false]),
    waitForTransactionReceipt: vi.fn().mockResolvedValue({ status: "success" }),
    writeContract: vi.fn().mockResolvedValue("0xtxhash"),
  };
}

describe("resolveRegisterPayoutAddress (cross-chain sweep address)", () => {
  const self = ("0x" + "1".repeat(40)) as `0x${string}`;

  afterEach(() => { delete process.env.ARCORA_RELAYER_SWEEP_ADDRESS; });

  it("returns self when no payout chain is set (same-chain Arc merchant)", () => {
    expect(resolveRegisterPayoutAddress({ self })).toBe(self);
  });

  it("returns self when the payout chain IS Arc", () => {
    expect(resolveRegisterPayoutAddress({ self, payoutChainId: ARC_CHAIN_ID })).toBe(self);
  });

  it("returns the default relayer sweep address for a cross-chain (non-Arc) merchant", () => {
    expect(resolveRegisterPayoutAddress({ self, payoutChainId: 84532 })).toBe(DEFAULT_SWEEP);
  });

  it("honors the explicit sweepAddress arg over the default", () => {
    const sweep = "0x" + "a".repeat(40);
    expect(resolveRegisterPayoutAddress({ self, payoutChainId: 84532, sweepAddress: sweep })).toBe(sweep);
  });

  it("honors ARCORA_RELAYER_SWEEP_ADDRESS when no explicit arg is passed", () => {
    const sweep = "0x" + "b".repeat(40);
    process.env.ARCORA_RELAYER_SWEEP_ADDRESS = sweep;
    expect(resolveRegisterPayoutAddress({ self, payoutChainId: 84532 })).toBe(sweep);
  });

  it("throws on a malformed sweep address", () => {
    expect(() => resolveRegisterPayoutAddress({ self, payoutChainId: 84532, sweepAddress: "not-an-address" })).toThrow(/invalid relayer sweep address/);
  });
});

describe("onboardMerchant", () => {
  it("runs SIWE+bootstrap and registers + authorizes the delegate, returning the api key", async () => {
    const fetchImpl = fakeFetch();
    const chain = fakeChain();
    const res = await onboardMerchant({
      account, baseUrl: "https://arcorapay.xyz",
      pub: { readContract: chain.readContract, waitForTransactionReceipt: chain.waitForTransactionReceipt },
      wallet: { writeContract: chain.writeContract },
      fetchImpl: fetchImpl as unknown as typeof fetch,
      nowSec: 1_750_000_000,
    });
    expect(res.apiKey).toBe("ak_live_TEST123");
    expect(res.merchantAddress).toBe(account.address);
    // registerMerchant + authorizeDelegate both sent (merchant was inactive, no delegate)
    expect(chain.writeContract).toHaveBeenCalledTimes(2);
    const fns = chain.writeContract.mock.calls.map((c) => c[0].functionName);
    expect(fns).toContain("registerMerchant");
    expect(fns).toContain("authorizeDelegate");
  });

  it("skips on-chain writes when already active + delegated (idempotent)", async () => {
    const fetchImpl = fakeFetch();
    const chain = fakeChain();
    chain.readContract
      .mockResolvedValueOnce([account.address, "0x3600000000000000000000000000000000000000", true]) // merchants(): active
      .mockResolvedValueOnce([9_999_999_999n, 1]); // delegates(): valid + CREATE right
    const res = await onboardMerchant({
      account, baseUrl: "https://arcorapay.xyz",
      pub: { readContract: chain.readContract, waitForTransactionReceipt: chain.waitForTransactionReceipt },
      wallet: { writeContract: chain.writeContract },
      fetchImpl: fetchImpl as unknown as typeof fetch,
      nowSec: 1_750_000_000,
    });
    expect(res.apiKey).toBe("ak_live_TEST123");
    expect(chain.writeContract).not.toHaveBeenCalled();
  });

  it("configures the payout chain when payoutChainId is supplied", async () => {
    const fetchImpl = fakeFetch();
    const chain = fakeChain();
    const res = await onboardMerchant({
      account, baseUrl: "https://arcorapay.xyz",
      pub: { readContract: chain.readContract, waitForTransactionReceipt: chain.waitForTransactionReceipt },
      wallet: { writeContract: chain.writeContract },
      fetchImpl: fetchImpl as unknown as typeof fetch,
      nowSec: 1_750_000_000,
      payoutChainId: 84532,
      payoutChainAddress: "0x" + "c".repeat(40),
    });
    expect(res.payoutChainId).toBe(84532);
    expect(res.payoutChainAddress).toBe("0x" + "c".repeat(40));
    const calls = fetchImpl.mock.calls.map((c) => c[0] as string);
    expect(calls.some((u) => u.endsWith("/api/merchant/payout-chain"))).toBe(true);
  });

  it("registers the relayer sweep address (not the merchant's own) for a cross-chain merchant", async () => {
    const fetchImpl = fakeFetch();
    const chain = fakeChain(); // merchant inactive → registerMerchant IS called
    await onboardMerchant({
      account, baseUrl: "https://arcorapay.xyz",
      pub: { readContract: chain.readContract, waitForTransactionReceipt: chain.waitForTransactionReceipt },
      wallet: { writeContract: chain.writeContract },
      fetchImpl: fetchImpl as unknown as typeof fetch,
      nowSec: 1_750_000_000,
      payoutChainId: 84532,
      payoutChainAddress: "0x" + "c".repeat(40),
      sweepAddress: DEFAULT_SWEEP,
    });
    const register = chain.writeContract.mock.calls.find((c) => c[0].functionName === "registerMerchant");
    expect(register).toBeDefined();
    // payoutAddress arg (index 0) must be the sweep address, not the merchant's own.
    expect((register![0].args[0] as string).toLowerCase()).toBe(DEFAULT_SWEEP.toLowerCase());
    expect((register![0].args[0] as string).toLowerCase()).not.toBe(account.address.toLowerCase());
  });

  it("registers the merchant's OWN address when no payout chain is set", async () => {
    const fetchImpl = fakeFetch();
    const chain = fakeChain();
    await onboardMerchant({
      account, baseUrl: "https://arcorapay.xyz",
      pub: { readContract: chain.readContract, waitForTransactionReceipt: chain.waitForTransactionReceipt },
      wallet: { writeContract: chain.writeContract },
      fetchImpl: fetchImpl as unknown as typeof fetch,
      nowSec: 1_750_000_000,
    });
    const register = chain.writeContract.mock.calls.find((c) => c[0].functionName === "registerMerchant");
    expect(register).toBeDefined();
    expect((register![0].args[0] as string).toLowerCase()).toBe(account.address.toLowerCase());
  });

  it("skips the payout-chain call when no payout chain is requested", async () => {
    const fetchImpl = fakeFetch();
    const chain = fakeChain();
    const res = await onboardMerchant({
      account, baseUrl: "https://arcorapay.xyz",
      pub: { readContract: chain.readContract, waitForTransactionReceipt: chain.waitForTransactionReceipt },
      wallet: { writeContract: chain.writeContract },
      fetchImpl: fetchImpl as unknown as typeof fetch,
      nowSec: 1_750_000_000,
    });
    expect(res.payoutChainId).toBeUndefined();
    const calls = fetchImpl.mock.calls.map((c) => c[0] as string);
    expect(calls.some((u) => u.endsWith("/api/merchant/payout-chain"))).toBe(false);
  });
});
