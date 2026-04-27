"use client";

import { useState } from "react";
import { useAccount, useWriteContract, usePublicClient, useChainId } from "wagmi";
import { parseAbi, type Hex, type Address } from "viem";
import { toast } from "sonner";
import { mapChainError } from "@/lib/chain/error-mapper";

const ERC20_ABI = parseAbi([
  "function approve(address spender, uint256 amount) external returns (bool)",
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

type State = "idle" | "approving" | "paying" | "success" | "error";

export function PayButton({ invoiceId, payInTokenAddress, amountIn, onPaid }: PayButtonProps) {
  const { address } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const [state, setState] = useState<State>("idle");
  const [txHash, setTxHash] = useState<Hex | undefined>(undefined);

  const gateway = process.env.NEXT_PUBLIC_GATEWAY_ADDRESS as Address;
  const arcId = 5042002;

  async function handlePay() {
    if (!address || !amountIn) return;
    if (chainId !== arcId) {
      toast.error("Switch to Arc Testnet to continue");
      return;
    }
    try {
      setState("approving");
      const approveHash = await writeContractAsync({
        address: payInTokenAddress,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [gateway, amountIn],
      });
      await publicClient!.waitForTransactionReceipt({ hash: approveHash });

      setState("paying");
      const payHash = await writeContractAsync({
        address: gateway,
        abi: GATEWAY_ABI,
        functionName: "pay",
        args: [invoiceId as Hex, amountIn],
      });
      setTxHash(payHash);
      await publicClient!.waitForTransactionReceipt({ hash: payHash });

      setState("success");
      onPaid(payHash);
    } catch (e) {
      setState("error");
      toast.error(mapChainError(e));
      setTimeout(() => setState("idle"), 2000);
    }
  }

  const label: Record<State, string> = {
    idle: "Pay",
    approving: "Approving EURC…",
    paying: "Paying…",
    success: "Paid ✓",
    error: "Try again",
  };

  return (
    <div className="space-y-2">
      <button
        onClick={handlePay}
        disabled={!address || !amountIn || state === "approving" || state === "paying" || state === "success"}
        className="btn-cb-pill w-full"
      >
        {label[state]}
      </button>
      {txHash && (
        <a
          href={`https://testnet.arcscan.app/tx/${txHash}`}
          target="_blank"
          rel="noopener noreferrer"
          className="block text-center text-xs text-cb-link hover:underline"
        >
          View transaction →
        </a>
      )}
    </div>
  );
}
