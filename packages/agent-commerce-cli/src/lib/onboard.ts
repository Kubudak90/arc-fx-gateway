// packages/agent-commerce-cli/src/lib/onboard.ts
import { SiweMessage } from "siwe";
import type { Account, Address } from "viem";
import { CHAIN_ID, ARC_USDC, GATEWAY, SERVER_WALLET, RIGHT_CREATE_INVOICE, GATEWAY_ABI } from "../constants";

// Arc chain id — a merchant whose payout chain is Arc settles on Arc directly
// (registers its own address). Cross-chain-payout merchants (payoutChainId set
// and != Arc) register the relayer's Arc *sweep* address as their on-chain
// payoutAddress so the relayer's claim() lands their escrowed USDC in relayer
// custody — the relayer then CCTP-bridges it to the merchant's target chain.
const ARC_CHAIN_ID = CHAIN_ID;
// Known relayer Arc address (Vault-derived signing key, also NEXT_PUBLIC_RELAYER_ADDRESS).
// Overridable via ARCORA_RELAYER_SWEEP_ADDRESS so a key rotation doesn't need a
// CLI rebuild. Lower-cased compare; the value is passed verbatim to registerMerchant.
const DEFAULT_RELAYER_SWEEP_ADDRESS = "0x29EcFedDF31E4dA4a62b89bADe35b224cE144DAE";

/** Resolve the on-chain payoutAddress to register for a merchant.
 *
 *  - Same-chain (Arc) merchant — payoutChainId unset or === Arc — registers its
 *    OWN address (`self`): the escrow claim delivers straight to the merchant.
 *  - Cross-chain-payout merchant — payoutChainId set and != Arc — registers the
 *    relayer's Arc sweep address so claim() sweeps the escrow into relayer
 *    custody for the OUT-hop CCTP bridge. The merchant's actual target-chain
 *    address is recorded OFF-CHAIN (payout-chain config), never on-chain.
 */
export function resolveRegisterPayoutAddress(args: {
  self: Address;
  payoutChainId?: number;
  sweepAddress?: string;
}): Address {
  const isCrossChain = args.payoutChainId !== undefined && args.payoutChainId !== ARC_CHAIN_ID;
  if (!isCrossChain) return args.self;
  const sweep = args.sweepAddress ?? process.env.ARCORA_RELAYER_SWEEP_ADDRESS ?? DEFAULT_RELAYER_SWEEP_ADDRESS;
  if (!/^0x[0-9a-fA-F]{40}$/.test(sweep)) {
    throw new Error(`invalid relayer sweep address: ${sweep}`);
  }
  return sweep as Address;
}

export interface ChainReader {
  readContract(args: { address: Address; abi: typeof GATEWAY_ABI; functionName: string; args: readonly unknown[] }): Promise<readonly unknown[]>;
  waitForTransactionReceipt(args: { hash: `0x${string}` }): Promise<{ status: string }>;
}
export interface ChainWriter {
  writeContract(args: { address: Address; abi: typeof GATEWAY_ABI; functionName: string; args: readonly unknown[] }): Promise<`0x${string}`>;
}

export interface OnboardArgs {
  account: Account;
  baseUrl: string;
  pub: ChainReader;
  wallet: ChainWriter;
  fetchImpl: typeof fetch;
  nowSec: number;
  onStep?: (msg: string) => void;
  // Optional merchant payout-chain config (the OUT hop, Plan 7). When
  // payoutChainId is set (and non-Arc), the merchant's settled USDC is
  // CCTP-bridged from Arc to this chain + address after settlement.
  payoutChainId?: number;
  payoutChainAddress?: string;
  // Relayer's Arc sweep address — the on-chain payoutAddress a cross-chain
  // merchant registers (so claim() lands the escrow in relayer custody for the
  // OUT-hop bridge). Defaults to ARCORA_RELAYER_SWEEP_ADDRESS / the known
  // relayer addr. Ignored for same-chain (Arc) merchants.
  sweepAddress?: string;
}

export interface OnboardResult {
  apiKey: string | null;
  merchantAddress: string;
  alreadyBootstrapped: boolean;
  payoutChainId?: number;
  payoutChainAddress?: string | null;
}

export async function onboardMerchant(a: OnboardArgs): Promise<OnboardResult> {
  const step = a.onStep ?? (() => {});
  const host = new URL(a.baseUrl).hostname;
  const headers = (extra: Record<string, string> = {}) => ({ Origin: a.baseUrl, Referer: `${a.baseUrl}/`, ...extra });
  const me = a.account.address as Address;

  // SIWE
  step("requesting nonce");
  const nonceRes = await a.fetchImpl(`${a.baseUrl}/api/auth/siwe/nonce`, { method: "POST", headers: headers() });
  const { nonce } = (await nonceRes.json()) as { nonce?: string };
  if (!nonce) throw new Error(`nonce_failed:${nonceRes.status}`);

  const message = new SiweMessage({
    domain: host, address: me, statement: "Arcora agent-merchant onboarding.",
    uri: a.baseUrl, version: "1", chainId: CHAIN_ID, nonce,
    issuedAt: new Date(a.nowSec * 1000).toISOString(),
  }).prepareMessage();
  const signature = await a.account.signMessage!({ message });

  step("verifying SIWE");
  const verifyRes = await a.fetchImpl(`${a.baseUrl}/api/auth/siwe/verify`, {
    method: "POST", headers: headers({ "content-type": "application/json" }),
    body: JSON.stringify({ message, signature }),
  });
  if (!verifyRes.ok) throw new Error(`siwe_verify_failed:${verifyRes.status}`);
  const setCookie = (verifyRes.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? [verifyRes.headers.get("set-cookie") ?? ""];
  const cookie = setCookie.filter(Boolean).map((c) => c.split(";")[0]).join("; ");

  step("bootstrapping merchant");
  const bootRes = await a.fetchImpl(`${a.baseUrl}/api/merchant/bootstrap`, {
    method: "POST", headers: headers({ "content-type": "application/json", Cookie: cookie }),
    body: JSON.stringify({ payoutToken: ARC_USDC, allowedOrigins: [a.baseUrl] }),
  });
  let apiKey: string | null = null;
  let alreadyBootstrapped = false;
  if (bootRes.status === 201) { apiKey = ((await bootRes.json()) as { apiKey: string }).apiKey; }
  else if (bootRes.status === 409) { alreadyBootstrapped = true; }
  else throw new Error(`bootstrap_failed:${bootRes.status}`);

  // Off-chain payout-chain config (the OUT hop). Set with the same session
  // cookie + Origin/Referer the bootstrap call carried. Only when requested.
  let payoutChainId: number | undefined;
  let payoutChainAddress: string | null | undefined;
  if (a.payoutChainId !== undefined) {
    step("configuring payout chain");
    const pcRes = await a.fetchImpl(`${a.baseUrl}/api/merchant/payout-chain`, {
      method: "POST", headers: headers({ "content-type": "application/json", Cookie: cookie }),
      body: JSON.stringify({ payoutChainId: a.payoutChainId, payoutChainAddress: a.payoutChainAddress ?? null }),
    });
    if (!pcRes.ok) throw new Error(`payout_chain_failed:${pcRes.status}`);
    const pc = (await pcRes.json()) as { payoutChainId: number; payoutChainAddress: string | null };
    payoutChainId = pc.payoutChainId;
    payoutChainAddress = pc.payoutChainAddress;
  }

  // On-chain: registerMerchant (if inactive) + authorizeDelegate (if not valid).
  const m = (await a.pub.readContract({ address: GATEWAY, abi: GATEWAY_ABI, functionName: "merchants", args: [me] }));
  if (!m[2]) {
    // Cross-chain-payout merchants register the relayer's Arc sweep address as
    // their on-chain payoutAddress (so claim() sweeps into relayer custody for
    // the OUT hop); same-chain (Arc) merchants register their own address.
    const registerPayoutAddress = resolveRegisterPayoutAddress({
      self: me,
      payoutChainId: a.payoutChainId,
      sweepAddress: a.sweepAddress,
    });
    step(registerPayoutAddress.toLowerCase() === me.toLowerCase()
      ? "registering merchant on-chain"
      : "registering merchant on-chain (payout → relayer sweep address for cross-chain bridge)");
    const tx = await a.wallet.writeContract({ address: GATEWAY, abi: GATEWAY_ABI, functionName: "registerMerchant", args: [registerPayoutAddress, ARC_USDC] });
    await a.pub.waitForTransactionReceipt({ hash: tx });
  }
  const d = (await a.pub.readContract({ address: GATEWAY, abi: GATEWAY_ABI, functionName: "delegates", args: [me, SERVER_WALLET] }));
  const valid = BigInt(d[0] as bigint) > BigInt(a.nowSec) && (Number(d[1]) & RIGHT_CREATE_INVOICE) !== 0;
  if (!valid) {
    step("authorizing delegate on-chain");
    const expiresAt = BigInt(a.nowSec + 365 * 24 * 3600);
    const tx = await a.wallet.writeContract({ address: GATEWAY, abi: GATEWAY_ABI, functionName: "authorizeDelegate", args: [SERVER_WALLET, expiresAt, RIGHT_CREATE_INVOICE] });
    await a.pub.waitForTransactionReceipt({ hash: tx });
  }
  return { apiKey, merchantAddress: me, alreadyBootstrapped, payoutChainId, payoutChainAddress };
}
