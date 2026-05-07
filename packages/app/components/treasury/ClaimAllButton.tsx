"use client";

import { useState } from "react";
import { useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import type { Address } from "viem";
import { gatewayAbi } from "@/lib/chain/gateway-abi";

// Read the V10 gateway address from the public env var directly — importing
// from `@/lib/chain/client` would transitively pull `pg` (server-only) into
// the client bundle and break the build with "Module not found: 'fs' / 'net'".
const GATEWAY_ADDRESS = (process.env.NEXT_PUBLIC_GATEWAY_ADDRESS_V10 ?? "") as Address;

interface ClaimAllButtonProps {
  globalIds: `0x${string}`[];
}

type Step = "idle" | "submitting" | "confirming" | "done" | "error";

/**
 * Permissionless claim button for V10 matured escrows.
 * Calls claim(bytes32[]) on the V10 gateway — anyone can call this,
 * not just the merchant. Funds route to merchants[merchant].payoutAddress.
 */
export function ClaimAllButton({ globalIds }: ClaimAllButtonProps) {
  const [step, setStep] = useState<Step>("idle");
  const { writeContractAsync } = useWriteContract();
  const [hash, setHash] = useState<`0x${string}` | undefined>(undefined);
  const { isSuccess } = useWaitForTransactionReceipt({ hash });

  if (globalIds.length === 0) {
    return <p className="text-sm text-muted-foreground">No matured escrows to claim.</p>;
  }

  if (isSuccess && step !== "done") setStep("done");

  async function onClick() {
    setStep("submitting");
    try {
      const tx = await writeContractAsync({
        address:      GATEWAY_ADDRESS,
        abi:          gatewayAbi,
        functionName: "claim",
        args:         [globalIds],
      });
      setHash(tx);
      setStep("confirming");
    } catch (e) {
      console.error(e);
      setStep("error");
    }
  }

  const label =
    step === "idle"       ? `Claim ${globalIds.length} matured invoice${globalIds.length === 1 ? "" : "s"}` :
    step === "submitting" ? "Submitting…" :
    step === "confirming" ? "Waiting for confirmation…" :
    step === "done"       ? "Claimed ✓" :
    /* error */             "Failed — retry";

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={onClick}
        disabled={step === "submitting" || step === "confirming" || step === "done"}
        className="inline-flex items-center gap-2 rounded-full bg-arcora-slate text-white px-4 py-2 text-sm font-semibold shadow-sm hover:bg-arcora-blue transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {label}
      </button>
      {hash && (
        <p className="text-xs text-muted-foreground font-mono">
          tx:{" "}
          <a
            href={`https://testnet.arcscan.app/tx/${hash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-arcora-link hover:underline"
          >
            {hash.slice(0, 10)}…
          </a>
        </p>
      )}
    </div>
  );
}
