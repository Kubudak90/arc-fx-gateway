"use client";

import { useState } from "react";
import { useAccount, useWriteContract, usePublicClient, useChainId } from "wagmi";
import { parseAbi, type Hex, type Address } from "viem";
import { toast } from "sonner";
import { mapChainError } from "@/lib/chain/error-mapper";

const ERC20_ABI = parseAbi([
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
]);
const GATEWAY_ABI = parseAbi([
  "function pay(bytes32 id, uint256 maxAmountIn) external",
]);

interface PayButtonProps {
  invoiceId: string;
  payInTokenAddress: Address;
  amountIn: bigint | null;
  onPaid: (txHash: Hex) => void;
}

type State = "idle" | "approving" | "approved" | "paying" | "success" | "error";

export function PayButton({ invoiceId, payInTokenAddress, amountIn, onPaid }: PayButtonProps) {
  const { address } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const [state, setState] = useState<State>("idle");
  const [txHash, setTxHash] = useState<Hex | undefined>(undefined);

  const gateway = process.env.NEXT_PUBLIC_GATEWAY_ADDRESS as Address;
  const arcId = 5042002;

  async function ensureAllowance(): Promise<void> {
    const current = await publicClient!.readContract({
      address: payInTokenAddress,
      abi: ERC20_ABI,
      functionName: "allowance",
      args: [address!, gateway],
    });
    if (current >= amountIn!) return;

    setState("approving");
    const approveHash = await writeContractAsync({
      address: payInTokenAddress,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [gateway, amountIn!],
    });
    await publicClient!.waitForTransactionReceipt({ hash: approveHash });
    setState("approved");
    // Brief settle so the next read sees the new allowance — some RPCs lag a tick.
    await new Promise(r => setTimeout(r, 600));
  }

  async function submitPay(): Promise<void> {
    setState("paying");
    const payHash = await writeContractAsync({
      address: gateway,
      abi: GATEWAY_ABI,
      functionName: "pay",
      args: [invoiceId as Hex, amountIn!],
    });
    setTxHash(payHash);
    await publicClient!.waitForTransactionReceipt({ hash: payHash });
    setState("success");
    onPaid(payHash);
  }

  async function handleClick() {
    if (!address || !amountIn) return;
    if (chainId !== arcId) {
      toast.error("Switch to Arc Testnet to continue");
      return;
    }
    try {
      // If a previous attempt already approved, skip straight to pay on retry.
      if (state !== "approved") {
        await ensureAllowance();
      }
      await submitPay();
    } catch (e) {
      // Allowance is on-chain; never roll the user back to "approve again" if pay fails.
      setState("error");
      toast.error(mapChainError(e));
    }
  }

  const label: Record<State, string> = {
    idle:      "Pay",
    approving: "Approving…",
    approved:  "Awaiting payment confirmation…",
    paying:    "Paying…",
    success:   "Paid ✓",
    error:     "Retry payment",
  };

  const inFlight = state === "approving" || state === "approved" || state === "paying";

  return (
    <div className="space-y-2">
      <button
        onClick={handleClick}
        disabled={!address || !amountIn || inFlight || state === "success"}
        className="btn-arcora-pill w-full"
      >
        {label[state]}
      </button>
      {txHash && (
        <a
          href={`https://testnet.arcscan.app/tx/${txHash}`}
          target="_blank"
          rel="noopener noreferrer"
          className="block text-center text-xs text-arcora-link hover:underline"
        >
          View transaction →
        </a>
      )}
    </div>
  );
}
