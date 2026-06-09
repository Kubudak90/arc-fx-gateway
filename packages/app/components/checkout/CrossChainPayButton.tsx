"use client";

import { useState } from "react";
import { parseAbi, type Address, type Hex } from "viem";
import {
  useAccount,
  useChainId,
  usePublicClient,
  useSwitchChain,
  useWriteContract,
} from "wagmi";
import { toast } from "sonner";
import { mapChainError } from "@/lib/chain/error-mapper";
import { chainLabel } from "./ChainSelector";

// CCTP v2 TokenMessenger. NOTE: the 5th param is named hookData here but is
// destinationCaller in the submit verifier — same encoded selector/types
// (bytes32); it must stay 32 zero bytes or the submit verifier rejects.
const TOKEN_MESSENGER_ABI = parseAbi([
  "function depositForBurn(uint256 amount,uint32 destinationDomain,bytes32 mintRecipient,address burnToken,bytes32 hookData,uint256 maxFee,uint32 finalityThreshold)",
]);

const ERC20_ABI = parseAbi([
  "function allowance(address owner,address spender) view returns (uint256)",
  "function approve(address spender,uint256 amount) returns (bool)",
]);

const TERMINAL_STATUSES = [
  "paid",
  "bridge_failed",
  "arc_swap_failed",
  "settle_failed",
  "refunded",
  "expired",
];

type State =
  | "idle"
  | "preparing"
  | "switching"
  | "approving"
  | "burning"
  | "submitted"
  | "settling"
  | "success"
  | "failed";

interface TerminalStatus {
  status: string;
  settleTxHash?: string | null;
  error?: string | null;
}

export function CrossChainPayButton(props: {
  invoiceId: string;
  sourceChainId: number;
  onPaid: (tx: Hex) => void;
  onFailed?: (reason: string) => void;
}) {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient({ chainId: props.sourceChainId });
  const [state, setState] = useState<State>("idle");

  async function poll(url: string): Promise<TerminalStatus> {
    for (let i = 0; i < 72; i++) { // 72 × 5s = 6 min
      const res = await fetch(url);
      const body = await res.json();
      if (TERMINAL_STATUSES.includes(body.status)) {
        return body;
      }
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
    throw new Error("timed out waiting for cross-chain settlement");
  }

  async function handleClick() {
    if (!address) return;
    try {
      setState("preparing");
      const prepareRes = await fetch("/api/checkout/crosschain/prepare", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ invoiceId: props.invoiceId, payer: address, sourceChainId: props.sourceChainId }),
      });
      const prepare = await prepareRes.json();
      if (!prepareRes.ok) throw new Error(prepare.error ?? "prepare failed");

      if (chainId !== props.sourceChainId) {
        setState("switching");
        await switchChainAsync({ chainId: props.sourceChainId });
      }
      if (!publicClient) throw new Error("source-chain client unavailable");

      const amount = BigInt(prepare.depositForBurn.amount);
      const burnToken = prepare.depositForBurn.burnToken as Address;
      const tokenMessenger = prepare.depositForBurn.tokenMessenger as Address;
      const allowance = await publicClient.readContract({
        address: burnToken,
        abi: ERC20_ABI,
        functionName: "allowance",
        args: [address, tokenMessenger],
      });

      if (allowance < amount) {
        setState("approving");
        const approvalTx = await writeContractAsync({
          chainId: props.sourceChainId,
          address: burnToken,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [tokenMessenger, amount],
        });
        await publicClient.waitForTransactionReceipt({ hash: approvalTx });
      }

      setState("burning");
      const tx = await writeContractAsync({
        chainId: props.sourceChainId,
        address: tokenMessenger,
        abi: TOKEN_MESSENGER_ABI,
        functionName: "depositForBurn",
        args: [
          amount,
          prepare.depositForBurn.destinationDomain,
          prepare.depositForBurn.mintRecipient as Hex,
          burnToken,
          // destinationCaller — must stay zero or the submit verifier rejects.
          "0x0000000000000000000000000000000000000000000000000000000000000000",
          BigInt(prepare.depositForBurn.maxFee),
          prepare.depositForBurn.finalityThreshold,
        ],
      });
      await publicClient.waitForTransactionReceipt({ hash: tx });

      setState("submitted");
      const submitRes = await fetch("/api/checkout/crosschain/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ intentId: prepare.intentId, burnTxHash: tx }),
      });
      const submitted = await submitRes.json();
      if (!submitRes.ok) throw new Error(submitted.error ?? "submit failed");

      setState("settling");
      const terminal = await poll(submitted.statusUrl);
      if (terminal.status === "paid" && terminal.settleTxHash) {
        setState("success");
        props.onPaid(terminal.settleTxHash as Hex);
      } else {
        setState("failed");
        // terminal.error is a stable enumerated code from the status route
        // (never raw RPC text), safe to surface as-is.
        const reason = terminal.error ?? `cross-chain payment failed: ${terminal.status}`;
        toast.error(reason);
        props.onFailed?.(reason);
      }
    } catch (e) {
      setState("failed");
      // Caught errors here include raw wallet/RPC text — map to a safe,
      // user-facing message like the Arc PayButton does (audit #12 posture).
      // Not forwarded to onFailed: a wallet rejection or transient RPC error
      // should leave the checkout retryable, mirroring PayButton's catch.
      toast.error(mapChainError(e));
    }
  }

  const busy = ["preparing", "switching", "approving", "burning", "submitted", "settling"].includes(state);
  const label =
    state === "preparing" ? "Preparing route…" :
    state === "switching" ? "Switching network…" :
    state === "approving" ? "Approving USDC…" :
    state === "burning" ? "Confirm bridge transaction…" :
    state === "submitted" ? "Submitting bridge proof…" :
    state === "settling" ? "Waiting for Arc settlement…" :
    state === "success" ? "Paid ✓" :
    `Bridge USDC from ${chainLabel(props.sourceChainId)}`;

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={!isConnected || !address || busy || state === "success"}
      className="btn-arcora-pill w-full"
      aria-live="polite"
      aria-busy={busy || undefined}
    >
      {label}
    </button>
  );
}
