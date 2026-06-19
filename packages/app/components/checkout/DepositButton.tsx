"use client";

import { useState } from "react";
import { useAccount, useChainId, usePublicClient, useSwitchChain, useWriteContract } from "wagmi";
import { parseAbi, type Address, type Hex } from "viem";
import { toast } from "sonner";
import { Check, Loader2 } from "lucide-react";
import { mapChainError } from "@/lib/chain/error-mapper";
import { getChainById, paymentEscrowAbi } from "@arcora/router";

const ERC20_ABI = parseAbi([
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
]);

interface DepositButtonProps {
  /** Off-chain chain-agnostic invoice id; doubles as the on-chain deposit idemKey. */
  invoiceRef: `0x${string}`;
  /** USDC minor units to lock (the buyer always locks USDC). */
  amount: bigint;
  /** Merchant's own payout address (no custody). */
  merchant: Address;
  /** Merchant payout CCTP domain. */
  payoutDomain: number;
  /** PaymentEscrow.PayoutToken index (USDC=0, EURC=1, USDT=2). */
  payoutTokenIndex: number;
  /** The chain the buyer pays from (must have a deployed PaymentEscrow). */
  payFromChainId: number;
  onDeposited: (escrowId: `0x${string}`, depositTx: Hex) => void;
}

type State = "idle" | "switching" | "approving" | "depositing" | "recording" | "success" | "failed";

export function DepositButton(props: DepositButtonProps) {
  const { address } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient({ chainId: props.payFromChainId });
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();

  const [state, setState] = useState<State>("idle");
  const [depositTx, setDepositTx] = useState<Hex | null>(null);

  const chain = getChainById(props.payFromChainId);
  const escrow = chain?.contracts.paymentEscrow as Address | undefined;
  const usdc = chain?.tokens.USDC as Address | undefined;

  async function handleClick() {
    if (!address || !publicClient || !escrow || !usdc) return;
    try {
      if (chainId !== props.payFromChainId) {
        setState("switching");
        await switchChainAsync({ chainId: props.payFromChainId });
      }

      // Finite approval of exactly `amount` to the escrow (never infinite).
      const allowance = (await publicClient.readContract({
        address: usdc, abi: ERC20_ABI, functionName: "allowance", args: [address, escrow],
      })) as bigint;
      if (allowance < props.amount) {
        setState("approving");
        const atx = await writeContractAsync({
          address: usdc, abi: ERC20_ABI, functionName: "approve", args: [escrow, props.amount],
        });
        await publicClient.waitForTransactionReceipt({ hash: atx });
      }

      // Lock USDC in the escrow. The escrowId is generated on-chain (byte[1] =
      // this chain's CCTP domain) — read it back via idemKeyToEscrow(invoiceRef).
      setState("depositing");
      const dtx = await writeContractAsync({
        address: escrow,
        abi: paymentEscrowAbi,
        functionName: "deposit",
        args: [{
          idemKey: props.invoiceRef,
          invoiceRef: props.invoiceRef,
          merchant: props.merchant,
          payoutDomain: props.payoutDomain,
          payoutToken: props.payoutTokenIndex,
          amount: props.amount,
        }],
      });
      await publicClient.waitForTransactionReceipt({ hash: dtx });
      setDepositTx(dtx);

      const escrowId = (await publicClient.readContract({
        address: escrow, abi: paymentEscrowAbi, functionName: "idemKeyToEscrow", args: [props.invoiceRef],
      })) as `0x${string}`;

      // Record the deposit so the backend can drive settlement (verified on-chain
      // server-side). No funds pass through us.
      setState("recording");
      await fetch("/api/checkout/v2/deposit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ invoiceRef: props.invoiceRef, escrowId, depositTx: dtx, escrowChainId: props.payFromChainId }),
      });

      setState("success");
      props.onDeposited(escrowId, dtx);
    } catch (e) {
      setState("failed");
      toast.error(mapChainError(e));
    }
  }

  const label: Record<State, string> = {
    idle: "Pay — lock USDC",
    switching: "Switch network…",
    approving: "Approve USDC…",
    depositing: "Confirm payment…",
    recording: "Finalizing…",
    success: "Paid ✓",
    failed: "Retry",
  };
  const inFlight = state !== "idle" && state !== "success" && state !== "failed";

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={handleClick}
        disabled={!address || inFlight || state === "success" || !escrow}
        aria-live="polite"
        aria-busy={inFlight || undefined}
        className="pill pill--acc w-full"
      >
        {inFlight && <Loader2 className="size-4 animate-spin inline mr-2" />}
        {state === "success" && <Check className="size-4 inline mr-2" />}
        {label[state]}
      </button>
      <p className="text-[11px] text-[var(--fg-3)] text-center">
        You lock USDC in escrow on your chain. No custody — funds settle to the merchant after a short
        refund window, or refund to you within it.
      </p>
      {depositTx && chain?.key && (
        <a
          href={`${chain.key === "arcTestnet" ? "https://testnet.arcscan.app" : "https://sepolia.basescan.org"}/tx/${depositTx}`}
          target="_blank" rel="noopener noreferrer"
          className="block text-center text-xs text-[var(--action)] hover:underline"
        >
          View deposit →
        </a>
      )}
    </div>
  );
}
