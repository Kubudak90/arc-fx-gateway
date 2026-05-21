"use client";

import { useEffect, useState } from "react";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import type { Address } from "viem";
import { toast } from "sonner";
import { GATEWAY_ABI } from "@/lib/chain/gateway-abi";
import { mapChainError } from "@/lib/chain/error-mapper";
import { symbolForAddress } from "@/lib/ui/format";

// Active custody-escrow gateway. Source-of-truth env: NEXT_PUBLIC_GATEWAY_ADDRESS.
const GATEWAY = (process.env.NEXT_PUBLIC_GATEWAY_ADDRESS ?? "") as Address;
const USDC = (process.env.NEXT_PUBLIC_USDC_ADDRESS ?? "") as Address;
const EURC = (process.env.NEXT_PUBLIC_EURC_ADDRESS ?? "") as Address;

interface TokenChoice {
  address: Address;
  symbol: string;
  fiat: string;
}

const CHOICES: TokenChoice[] = [
  { address: USDC, symbol: "USDC", fiat: "US Dollar" },
  { address: EURC, symbol: "EURC", fiat: "Euro" },
].filter((c) => c.address.startsWith("0x") && c.address.length === 42);

interface Props {
  currentPayoutToken: string;
  onUpdated?: () => void;
}

export function PayoutTokenCard({ currentPayoutToken, onUpdated }: Props) {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  const [selected, setSelected] = useState<Address>(currentPayoutToken as Address);
  const [busy, setBusy] = useState(false);

  // Keep selected in sync if the parent refreshes with a new value.
  useEffect(() => {
    setSelected(currentPayoutToken as Address);
  }, [currentPayoutToken]);

  const currentSymbol = symbolForAddress(currentPayoutToken);
  const dirty = selected.toLowerCase() !== currentPayoutToken.toLowerCase();

  async function handleSave() {
    if (!address || !publicClient) return;
    if (!GATEWAY.startsWith("0x")) {
      toast.error("Gateway not configured.");
      return;
    }
    setBusy(true);
    try {
      const hash = await writeContractAsync({
        address: GATEWAY,
        abi: GATEWAY_ABI,
        functionName: "updatePayoutToken",
        args: [selected],
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("update reverted");

      const res = await fetch("/api/merchant/payout-token", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ payoutToken: selected }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `sync_failed_${res.status}`);
      }

      toast.success(`Settle currency updated to ${symbolForAddress(selected)}`);
      onUpdated?.();
    } catch (e) {
      toast.error(mapChainError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="glass p-6">
      <div className="flex items-baseline justify-between mb-1">
        <span className="eyebrow">Settle currency</span>
        <span className="tag">{currentSymbol}</span>
      </div>
      <p className="text-[13px] text-arcora-deep mt-2 mb-4 leading-snug">
        The stable that all incoming payments convert to. Existing invoices keep
        their original settle token; only new invoices use this one.
      </p>

      <div role="radiogroup" aria-label="Settle currency" className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
        {CHOICES.map((c) => {
          const isSelected = selected.toLowerCase() === c.address.toLowerCase();
          return (
            <button
              key={c.address}
              type="button"
              role="radio"
              aria-checked={isSelected}
              onClick={() => setSelected(c.address)}
              disabled={busy}
              className={[
                "flex items-center justify-between px-4 py-3 rounded-xl border text-left transition-colors",
                isSelected
                  ? "border-arcora-blue bg-arcora-blue/5"
                  : "border-arcora-border bg-white hover:border-arcora-deep/30",
                busy ? "opacity-60 cursor-not-allowed" : "cursor-pointer",
              ].join(" ")}
            >
              <div className="flex flex-col">
                <span className="text-[14px] font-medium text-arcora-slate">{c.symbol}</span>
                <span className="text-[11.5px] text-arcora-muted-fg">{c.fiat}</span>
              </div>
              <span
                className={[
                  "w-4 h-4 rounded-full border-2 flex-none flex items-center justify-center",
                  isSelected ? "border-arcora-blue" : "border-arcora-border",
                ].join(" ")}
                aria-hidden="true"
              >
                {isSelected && <span className="w-2 h-2 rounded-full bg-arcora-blue" />}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex items-center justify-between gap-3">
        <span className="mono text-[11px] text-arcora-muted-fg">
          One on-chain transaction, ~10s.
        </span>
        <button
          type="button"
          onClick={handleSave}
          disabled={!dirty || busy || !address}
          className="inline-flex items-center gap-2 rounded-full bg-arcora-slate text-white px-4 py-2 text-sm font-semibold hover:bg-arcora-blue transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {busy ? "Updating…" : dirty ? "Update on-chain" : "No change"}
        </button>
      </div>
    </section>
  );
}
