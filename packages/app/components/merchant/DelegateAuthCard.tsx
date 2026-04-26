"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAccount, useWriteContract, useReadContract, usePublicClient } from "wagmi";
import { parseAbi, type Address } from "viem";
import { useState } from "react";
import { toast } from "sonner";

const GW_ABI = parseAbi([
  "function authorizeDelegate(address delegate, uint64 expiresAt) external",
  "function delegateAuthorizations(address merchant, address delegate) view returns (uint64)",
  "function registerMerchant(address payoutToken) external",
  "function merchants(address) view returns (address payoutToken, bool registered)",
]);

export function DelegateAuthCard({ serverWalletAddress }: { serverWalletAddress: string | null }) {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const [busy, setBusy] = useState<"register" | "authorize" | null>(null);
  const gateway = process.env.NEXT_PUBLIC_GATEWAY_ADDRESS as Address;
  const usdc = process.env.NEXT_PUBLIC_USDC_ADDRESS as Address;

  const { data: merchantInfo } = useReadContract({
    address: gateway,
    abi: GW_ABI,
    functionName: "merchants",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  const { data: authExpiry } = useReadContract({
    address: gateway,
    abi: GW_ABI,
    functionName: "delegateAuthorizations",
    args: address && serverWalletAddress ? [address, serverWalletAddress as Address] : undefined,
    query: { enabled: !!address && !!serverWalletAddress },
  });

  const isRegistered = merchantInfo?.[1] ?? false;
  const isAuthorized = authExpiry !== undefined && authExpiry > BigInt(Math.floor(Date.now() / 1000));

  async function register() {
    setBusy("register");
    try {
      const hash = await writeContractAsync({
        address: gateway,
        abi: GW_ABI,
        functionName: "registerMerchant",
        args: [usdc],
      });
      await publicClient!.waitForTransactionReceipt({ hash });
      toast.success("Registered as merchant on-chain");
    } catch (e: any) { toast.error(e.shortMessage ?? e.message); }
    finally { setBusy(null); }
  }

  async function authorize() {
    if (!serverWalletAddress) return;
    setBusy("authorize");
    try {
      const hash = await writeContractAsync({
        address: gateway,
        abi: GW_ABI,
        functionName: "authorizeDelegate",
        args: [serverWalletAddress as Address, BigInt("18446744073709551615")],
      });
      await publicClient!.waitForTransactionReceipt({ hash });
      toast.success("Server delegate authorized");
    } catch (e: any) { toast.error(e.shortMessage ?? e.message); }
    finally { setBusy(null); }
  }

  return (
    <Card>
      <CardHeader><CardTitle>On-chain authorization</CardTitle></CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="flex items-center justify-between">
          <span>Merchant registered</span>
          <span className={isRegistered ? "text-emerald-600 font-semibold" : "text-amber-600 font-semibold"}>
            {isRegistered ? "Yes" : "Not yet"}
          </span>
        </div>
        {!isRegistered && (
          <Button onClick={register} disabled={busy === "register"}>
            {busy === "register" ? "Confirming…" : "Register on-chain"}
          </Button>
        )}
        {isRegistered && (
          <>
            <div className="flex items-center justify-between">
              <span>Server delegate authorized</span>
              <span className={isAuthorized ? "text-emerald-600 font-semibold" : "text-amber-600 font-semibold"}>
                {isAuthorized ? "Yes" : "Not yet"}
              </span>
            </div>
            <p className="text-muted-foreground">
              Authorizing the server delegate lets us submit invoices on your behalf.
              You retain full control — you can revoke any time.
            </p>
            {!isAuthorized && (
              <Button onClick={authorize} disabled={busy === "authorize" || !serverWalletAddress}>
                {busy === "authorize" ? "Confirming…" : "Authorize delegate"}
              </Button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
