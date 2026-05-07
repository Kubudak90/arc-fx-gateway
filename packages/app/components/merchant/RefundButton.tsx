"use client";

import { useState } from "react";
import { useAccount, useWriteContract, usePublicClient, useChainId } from "wagmi";
import { type Hex, type Address } from "viem";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { gatewayAbi } from "@/lib/chain/gateway-abi";
import { mapChainError } from "@/lib/chain/error-mapper";

interface RefundButtonProps {
  invoiceId: string;
  payoutToken: string;
  /** The gateway address this invoice lives on. V10: custody — no ERC-20
   *  allowance needed. Falls back to NEXT_PUBLIC_GATEWAY_ADDRESS. */
  gatewayAddress?: string | null;
  /** V10: claimableAt from the DB row. Refunds are only valid before this
   *  timestamp (within the 7-day window). If absent, assume refundable. */
  claimableAt?: string | null;
  /** Current invoice status — only "paid" invoices are refundable. */
  status?: string;
  onRefunded?: () => void;
}

type State = "idle" | "refunding" | "success" | "error";

export function RefundButton({ invoiceId, payoutToken: _payoutToken, gatewayAddress, claimableAt, status, onRefunded }: RefundButtonProps) {
  const { address } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const [state, setState] = useState<State>("idle");

  // V10 window gating: refunds are only valid within the 7-day escrow window.
  const refundEndsAt = claimableAt ? new Date(claimableAt) : null;
  const stillRefundable = (status === "paid" || status === undefined) &&
    (refundEndsAt === null || Date.now() < refundEndsAt.getTime());

  const fallbackGateway = process.env.NEXT_PUBLIC_GATEWAY_ADDRESS as Address;
  const gateway = (gatewayAddress ?? fallbackGateway) as Address;
  const arcId = 5042002;

  if (!stillRefundable) return null;

  async function handleClick() {
    if (!address) return;
    if (chainId !== arcId) {
      toast.error("Switch to Arc Testnet to continue");
      return;
    }
    setState("refunding");
    try {
      // V10 custody: no ERC-20 allowance needed — escrow held in gateway.
      const refundHash = await writeContractAsync({
        address: gateway,
        abi: gatewayAbi,
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
    refunding: "Refunding…",
    success:   "Refunded ✓",
    error:     "Retry",
  };
  const inFlight = state === "refunding";

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
