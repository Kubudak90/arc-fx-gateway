"use client";

import { useEffect, useState } from "react";
import { useAccount, useChainId, usePublicClient, useWriteContract } from "wagmi";
import type { Address } from "viem";
import { GATEWAY_ABI } from "@/lib/chain/gateway-abi";
import { mapChainError } from "@/lib/chain/error-mapper";
import { toast } from "sonner";
import { ShieldCheck } from "lucide-react";

/**
 * V10 cutover prompt for the merchant dashboard.
 *
 * Why it exists: V10 (custody escrow gateway) is a fresh deployment — every
 * merchant must call `registerMerchant` on V10 before any invoice can be
 * created. Until they do, `/api/invoices` reverts on-chain with
 * `MerchantInactive`. This card walks them through the one-shot registration
 * AND the delegate authorization (so the server can submit invoices on
 * their behalf via createInvoiceFor with RIGHT_CREATE_INVOICE).
 *
 * Hidden once the merchant is registered + delegate authorized on V10.
 */

// V11 (audit-fix bytecode) preferred when set; V10 fallback for unmigrated envs.
const GATEWAY_V10 = (
  process.env.NEXT_PUBLIC_GATEWAY_ADDRESS_V11 ??
  process.env.NEXT_PUBLIC_GATEWAY_ADDRESS_V10 ??
  ""
) as Address;
const ARC_CHAIN_ID = 5042002;
// V10 bit-flag right for createInvoiceFor (RIGHT_CREATE_INVOICE = 1 << 0)
const RIGHT_CREATE_INVOICE = 1;

interface Props {
  payoutAddress: string;
  payoutToken: string;
}

export function MerchantV10ActivationCard({ payoutAddress, payoutToken }: Props) {
  const { address } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const [registeredOnV10, setRegisteredOnV9] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  // Probe V10 registration on mount (and after a successful tx).
  useEffect(() => {
    if (!address || !publicClient || !GATEWAY_V10.startsWith("0x")) {
      setRegisteredOnV9(null);
      return;
    }
    let cancelled = false;
    publicClient.readContract({
      address: GATEWAY_V10,
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
    if (!GATEWAY_V10.startsWith("0x")) {
      toast.error("V10 gateway not configured. Contact support.");
      return;
    }
    setBusy(true);
    try {
      const txHash = await writeContractAsync({
        address: GATEWAY_V10,
        abi: GATEWAY_ABI,
        functionName: "registerMerchant",
        args: [payoutAddress as Address, payoutToken as Address],
      });
      const receipt = await publicClient!.waitForTransactionReceipt({ hash: txHash });
      if (receipt.status !== "success") throw new Error("registration reverted");
      toast.success("V10 activation successful — registered on the custody gateway.");
      setRegisteredOnV9(true);
    } catch (e) {
      toast.error(mapChainError(e));
    } finally {
      setBusy(false);
    }
  }

  // Hide until we know status. Hide if already registered or env missing.
  if (!GATEWAY_V10.startsWith("0x")) return null;
  if (registeredOnV10 !== false) return null;

  return (
    <div className="rounded-2xl border border-arcora-blue/30 bg-gradient-to-br from-arcora-blue/5 to-arcora-teal/5 p-5 sm:p-6">
      <div className="flex items-start gap-4">
        <div className="rounded-xl bg-white border border-arcora-border p-2 flex-none">
          <ShieldCheck className="size-5 text-arcora-blue" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-arcora-slate">Activate V10 gateway</h3>
          <p className="mt-1 text-sm text-muted-foreground leading-relaxed">
            V10 is the custody-escrow gateway. Funds settle into per-invoice
            escrow for 7 days (refundable window) before being claimable.
            Register once on-chain to start accepting payments. After this
            you&apos;ll be prompted to authorize the server delegate from
            <span className="font-medium"> Settings</span>.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleActivate}
              disabled={!address || busy}
              aria-busy={busy || undefined}
              className="inline-flex items-center gap-2 rounded-full bg-arcora-slate text-white px-4 py-2 text-sm font-semibold shadow-sm hover:bg-arcora-blue transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {busy ? "Registering…" : "Activate V10 →"}
            </button>
            <span className="font-[family-name:var(--font-mono)] text-[11px] text-muted-foreground">
              One-time signature, ~10s.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
