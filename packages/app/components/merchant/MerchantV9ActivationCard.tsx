"use client";

import { useEffect, useState } from "react";
import { useAccount, useChainId, usePublicClient, useWriteContract } from "wagmi";
import type { Address } from "viem";
import { GATEWAY_ABI } from "@/lib/chain/gateway-abi";
import { mapChainError } from "@/lib/chain/error-mapper";
import { toast } from "sonner";
import { ShieldCheck } from "lucide-react";

/**
 * Plan-9 cutover prompt for the merchant dashboard.
 *
 * Why it exists: V9 fixed the V8 refundInvoice bug (refunds pulled from
 * inv.merchant rather than the actual payout source). New invoices default
 * to V9, but existing merchants only have a V8 registration on file. Until
 * a merchant calls `registerMerchant` on V9, V9 invoice creation will revert
 * with `MerchantInactive`. This card walks them through that one-shot
 * registration.
 *
 * Hidden once the merchant is registered on V9.
 */

const GATEWAY_V9 = (process.env.NEXT_PUBLIC_GATEWAY_ADDRESS_V9 ?? "") as Address;
const ARC_CHAIN_ID = 5042002;

interface Props {
  payoutAddress: string;
  payoutToken: string;
}

export function MerchantV9ActivationCard({ payoutAddress, payoutToken }: Props) {
  const { address } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const [registeredOnV9, setRegisteredOnV9] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  // Probe V9 registration on mount (and after a successful tx).
  useEffect(() => {
    if (!address || !publicClient || !GATEWAY_V9.startsWith("0x")) {
      setRegisteredOnV9(null);
      return;
    }
    let cancelled = false;
    publicClient.readContract({
      address: GATEWAY_V9,
      abi: GATEWAY_ABI,
      functionName: "merchants",
      args: [address],
    }).then((res) => {
      if (cancelled) return;
      // merchants() returns (payoutAddress, payoutToken, active). Index 2 is active.
      const active = (res as [string, string, boolean])[2];
      setRegisteredOnV9(active);
    }).catch(() => {
      if (cancelled) return;
      setRegisteredOnV9(null);
    });
    return () => { cancelled = true; };
  }, [address, publicClient]);

  async function handleActivate() {
    if (!address) return;
    if (chainId !== ARC_CHAIN_ID) {
      toast.error("Switch to Arc Testnet to continue");
      return;
    }
    if (!GATEWAY_V9.startsWith("0x")) {
      toast.error("V9 gateway not configured. Contact support.");
      return;
    }
    setBusy(true);
    try {
      const txHash = await writeContractAsync({
        address: GATEWAY_V9,
        abi: GATEWAY_ABI,
        functionName: "registerMerchant",
        args: [payoutAddress as Address, payoutToken as Address],
      });
      const receipt = await publicClient!.waitForTransactionReceipt({ hash: txHash });
      if (receipt.status !== "success") throw new Error("registration reverted");
      toast.success("V9 activation successful — new invoices default to V9.");
      setRegisteredOnV9(true);
    } catch (e) {
      toast.error(mapChainError(e));
    } finally {
      setBusy(false);
    }
  }

  // Hide until we know status. Hide if already registered or env missing.
  if (!GATEWAY_V9.startsWith("0x")) return null;
  if (registeredOnV9 !== false) return null;

  return (
    <div className="rounded-2xl border border-arcora-blue/30 bg-gradient-to-br from-arcora-blue/5 to-arcora-teal/5 p-5 sm:p-6">
      <div className="flex items-start gap-4">
        <div className="rounded-xl bg-white border border-arcora-border p-2 flex-none">
          <ShieldCheck className="size-5 text-arcora-blue" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-arcora-slate">Activate V9 gateway</h3>
          <p className="mt-1 text-sm text-muted-foreground leading-relaxed">
            V9 fixes the V8 refund flow so merchants whose payout wallet differs
            from their identity wallet can refund cleanly. New invoices default
            to V9 once you register. One-time signature, ~10s.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleActivate}
              disabled={!address || busy}
              className="inline-flex items-center gap-2 rounded-full bg-arcora-slate text-white px-4 py-2 text-sm font-semibold shadow-sm hover:bg-arcora-blue transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {busy ? "Registering…" : "Activate V9 →"}
            </button>
            <span className="font-[family-name:var(--font-mono)] text-[11px] text-muted-foreground">
              Existing V8 invoices keep refunding on V8.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
