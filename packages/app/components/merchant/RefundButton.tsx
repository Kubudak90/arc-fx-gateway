"use client";

import { useState } from "react";
import { useAccount, useWriteContract, usePublicClient, useChainId } from "wagmi";
import { parseAbi, type Hex, type Address } from "viem";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { GATEWAY_ABI, PAYMENTS_V8_ABI, PAYMENTS_V9_ABI } from "@/lib/chain/gateway-abi";
import { mapChainError } from "@/lib/chain/error-mapper";

const ERC20_ABI = parseAbi([
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
]);

interface RefundButtonProps {
  invoiceId: string;
  payoutToken: string;
  /** The gateway address this invoice lives on. Plan-9 cutover: per-row
   *  routing so V8 invoices refund on V8 contract and V9 on V9 contract.
   *  Falls back to NEXT_PUBLIC_GATEWAY_ADDRESS for legacy v0.6 invoices. */
  gatewayAddress?: string | null;
  onRefunded?: () => void;
}

type State = "idle" | "approving" | "refunding" | "success" | "error";

const GATEWAY_V9 = (process.env.NEXT_PUBLIC_GATEWAY_ADDRESS_V9 ?? "").toLowerCase();

export function RefundButton({ invoiceId, payoutToken, gatewayAddress, onRefunded }: RefundButtonProps) {
  const { address } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const [state, setState] = useState<State>("idle");

  const fallbackGateway = process.env.NEXT_PUBLIC_GATEWAY_ADDRESS as Address;
  const gateway = (gatewayAddress ?? fallbackGateway) as Address;
  const isV9 = !!gatewayAddress && gatewayAddress.toLowerCase() === GATEWAY_V9;
  const paymentsAbi = isV9 ? PAYMENTS_V9_ABI : PAYMENTS_V8_ABI;
  const arcId = 5042002;

  async function handleClick() {
    if (!address) return;
    if (chainId !== arcId) {
      toast.error("Switch to Arc Testnet to continue");
      return;
    }
    try {
      // Look up the exact merchantPayout we owe back; we'll approve only that.
      // Destructure handles both V8 [merchantPayout, fee] and V9
      // [merchantPayout, fee, payoutSource] shapes via PAYMENTS_V*_ABI.
      const result = await publicClient!.readContract({
        address: gateway,
        abi: paymentsAbi,
        functionName: "payments",
        args: [invoiceId as Hex],
      });
      const merchantPayout = result[0];
      if (merchantPayout === 0n) {
        toast.error("Refund record missing on-chain — invoice may not be paid yet.");
        return;
      }

      const allowance = await publicClient!.readContract({
        address: payoutToken as Address,
        abi: ERC20_ABI,
        functionName: "allowance",
        args: [address, gateway],
      });

      if (allowance < merchantPayout) {
        setState("approving");
        const approveHash = await writeContractAsync({
          address: payoutToken as Address,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [gateway, merchantPayout],
        });
        await publicClient!.waitForTransactionReceipt({ hash: approveHash });
        await new Promise(r => setTimeout(r, 600));
      }

      setState("refunding");
      const refundHash = await writeContractAsync({
        address: gateway,
        abi: GATEWAY_ABI,
        functionName: "refundInvoice",
        args: [invoiceId as Hex],
      });
      const receipt = await publicClient!.waitForTransactionReceipt({ hash: refundHash });
      if (receipt.status !== "success") {
        throw new Error("Refund reverted on-chain.");
      }

      setState("success");
      toast.success("Refund processed.");
      onRefunded?.();
    } catch (e) {
      setState("error");
      toast.error(mapChainError(e));
      setTimeout(() => setState("idle"), 2500);
    }
  }

  const label: Record<State, string> = {
    idle:      "Refund",
    approving: "Approving…",
    refunding: "Refunding…",
    success:   "Refunded ✓",
    error:     "Retry",
  };
  const inFlight = state === "approving" || state === "refunding";

  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={handleClick}
      disabled={!address || inFlight || state === "success"}
      className="text-arcora-link hover:bg-arcora-gray"
    >
      {label[state]}
    </Button>
  );
}
