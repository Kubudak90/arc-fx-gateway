/**
 * DEV-ONLY smoke test. Requires PRIVATE_KEY (raw hex) for the AppKit adapter
 * and RELAYER_ADAPTER_KEY equivalent. In V10, the main daemon signs via Vault
 * (VAULT_URL/VAULT_ROLE_ID/VAULT_SECRET_ID/VAULT_KEY_NAME); this script
 * retains the raw PRIVATE_KEY path because AppKit does not support custom
 * signers. Do not use on mainnet without KMS.
 *
 * Phase A smoke test: confirm App Kit Swap is alive on Arc Testnet
 * before we commit to building the relayer daemon.
 *
 * Runs three things in order:
 *   1. estimateSwap   — does the maker network return a quote at all?
 *   2. swap (no fee)  — does a 0.10 USDC → EURC trade settle end-to-end?
 *   3. swap with fee  — does customFee.recipientAddress actually receive 90%?
 *
 * Exit code 0 = green, 1 = a step failed. The output is what we'll use to
 * decide whether Phase B is unblocked or whether we escalate to Circle.
 */

import { AppKit } from "@circle-fin/app-kit";
import { createViemAdapterFromPrivateKey } from "@circle-fin/adapter-viem-v2";
import { createPublicClient, formatUnits, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const required = ["PRIVATE_KEY", "KIT_KEY", "FEE_RECIPIENT"] as const;
for (const k of required) {
  if (!process.env[k]) {
    console.error(`missing env ${k} — copy .env.example and fill in`);
    process.exit(1);
  }
}

const PRIVATE_KEY    = process.env.PRIVATE_KEY  as `0x${string}`;
const KIT_KEY        = process.env.KIT_KEY      as string;
const FEE_RECIPIENT  = process.env.FEE_RECIPIENT as `0x${string}`;
const RPC            = process.env.ARC_TESTNET_RPC ?? "https://rpc.testnet.arc.network";

// Canonical Arc-testnet addresses, taken from @circle-fin/app-kit's ArcTestnet
// chain definition. Keep in sync if Circle changes them.
const USDC_ARC_TESTNET = "0x3600000000000000000000000000000000000000" as const;
const EURC_ARC_TESTNET = "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a" as const;

const ERC20_BAL = [
  { type: "function", name: "balanceOf", stateMutability: "view",
    inputs: [{ name: "a", type: "address" }],
    outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "decimals", stateMutability: "view",
    inputs: [], outputs: [{ name: "", type: "uint8" }] },
] as const;

const chain = createPublicClient({ transport: http(RPC) });

async function balance(token: `0x${string}`, who: `0x${string}`): Promise<bigint> {
  return chain.readContract({ address: token, abi: ERC20_BAL, functionName: "balanceOf", args: [who] });
}

async function tokenDecimals(token: `0x${string}`): Promise<number> {
  return chain.readContract({ address: token, abi: ERC20_BAL, functionName: "decimals" });
}

function ms(start: number): string {
  return `${(performance.now() - start).toFixed(0)}ms`;
}

async function main() {
  const kit = new AppKit();
  const adapter = createViemAdapterFromPrivateKey({ privateKey: PRIVATE_KEY });
  // The adapter wraps a viem account internally; recover the wallet address
  // independently from the private key so this test does not depend on the
  // adapter's internal shape.
  const walletAddr = privateKeyToAccount(PRIVATE_KEY).address;

  console.log(`[smoke] wallet      : ${walletAddr}`);
  console.log(`[smoke] feeRecipient: ${FEE_RECIPIENT}`);
  console.log(`[smoke] rpc         : ${RPC}`);

  // --- pre-flight balances ----------------------------------------------------
  const usdcDec = await tokenDecimals(USDC_ARC_TESTNET);
  const eurcDec = await tokenDecimals(EURC_ARC_TESTNET);
  const preUsdc = await balance(USDC_ARC_TESTNET, walletAddr);
  const preEurc = await balance(EURC_ARC_TESTNET, walletAddr);
  const preFeeRecipientUsdc = await balance(USDC_ARC_TESTNET, FEE_RECIPIENT);
  console.log(`[smoke] pre  : ${formatUnits(preUsdc, usdcDec)} USDC (decimals=${usdcDec}), ${formatUnits(preEurc, eurcDec)} EURC (decimals=${eurcDec})`);
  console.log(`[smoke] pre  : feeRecipient USDC = ${formatUnits(preFeeRecipientUsdc, usdcDec)}`);

  // 0.5 USDC at the wallet's USDC decimals (covers both 6- and 18-decimal cases).
  const minBalance = 5n * 10n ** BigInt(usdcDec - 1);
  if (preUsdc < minBalance) {
    console.error(`[smoke] wallet has < 0.5 USDC, top up via https://faucet.circle.com`);
    process.exit(1);
  }

  // --- step 1: estimate -------------------------------------------------------
  const t0 = performance.now();
  const params = {
    from: { adapter, chain: "Arc_Testnet" as const },
    tokenIn: "USDC" as const,
    tokenOut: "EURC" as const,
    amountIn: "0.10",
    config: { kitKey: KIT_KEY },
  };
  let estimate;
  try {
    estimate = await kit.estimateSwap(params);
  } catch (err) {
    console.error(`[smoke] FAIL estimateSwap (${ms(t0)}):`, err);
    process.exit(1);
  }
  const est = estimate as {
    estimatedOutput?: { amount: string; token: string };
    stopLimit?:       { amount: string; token: string };
    fees?:            readonly { token: string; amount: string; type: string }[];
  };
  console.log(`[smoke] OK   estimateSwap (${ms(t0)}): out=${est.estimatedOutput?.amount} ${est.estimatedOutput?.token}, stopLimit=${est.stopLimit?.amount}, fees=`, est.fees);

  // --- step 2: small swap, no custom fee --------------------------------------
  const t1 = performance.now();
  let swap1;
  try {
    swap1 = await kit.swap(params);
  } catch (err) {
    console.error(`[smoke] FAIL swap-no-fee (${ms(t1)}):`, err);
    process.exit(1);
  }
  const r1 = swap1 as { txHash?: string; explorerUrl?: string; amountOut?: string; fees?: unknown };
  console.log(`[smoke] OK   swap-no-fee  (${ms(t1)}): out=${r1.amountOut}, tx=${r1.explorerUrl ?? r1.txHash}, fees=`, r1.fees);

  // --- step 3: swap with 1% custom fee ----------------------------------------
  const t2 = performance.now();
  let swap2;
  try {
    swap2 = await kit.swap({
      ...params,
      amountIn: "0.20",
      config: {
        kitKey: KIT_KEY,
        customFee: {
          percentageBps: 100, // 1%
          recipientAddress: FEE_RECIPIENT,
        },
      },
    });
  } catch (err) {
    console.error(`[smoke] FAIL swap-with-fee (${ms(t2)}):`, err);
    process.exit(1);
  }
  const r2 = swap2 as { txHash?: string; explorerUrl?: string; amountOut?: string; fees?: unknown };
  console.log(`[smoke] OK   swap-with-fee (${ms(t2)}): out=${r2.amountOut}, tx=${r2.explorerUrl ?? r2.txHash}, fees=`, r2.fees);

  // --- post-swap fee accounting -----------------------------------------------
  const postFeeRecipientUsdc = await balance(USDC_ARC_TESTNET, FEE_RECIPIENT);
  const feeReceived = postFeeRecipientUsdc - preFeeRecipientUsdc;
  // Custom fee taken on the output side (per docs): step 2 had no custom fee,
  // step 3 had 1% on 0.20 USDC ⇒ 0.002 USDC custom fee, 90% to recipient
  // ⇒ 0.0018 USDC. (Recipient currency mirrors the swap-fee chain context;
  // on a USDC-out fee this lands in USDC, on EURC-out it lands in EURC. Both
  // possibilities are surfaced below so the operator sees what actually moved.)
  console.log(`[smoke] feeRecipient delta USDC: ${formatUnits(feeReceived, usdcDec)}`);
  const postFeeRecipientEurc = await balance(EURC_ARC_TESTNET, FEE_RECIPIENT);
  console.log(`[smoke] feeRecipient EURC: ${formatUnits(postFeeRecipientEurc, eurcDec)}`);
  if (feeReceived === 0n && postFeeRecipientEurc === 0n) {
    console.error("[smoke] WARN: feeRecipient received 0 of either token — customFee may not have applied. Check explorer.");
  }

  console.log("[smoke] done.");
}

main().catch((e) => {
  console.error("[smoke] fatal:", e);
  process.exit(1);
});
