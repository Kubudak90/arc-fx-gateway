"use client";

import { useAccount, useConnect, useSignMessage, useDisconnect } from "wagmi";
import { injected } from "wagmi/connectors";
import { SiweMessage } from "siwe";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

export function ConnectMerchantButton() {
  const { address, isConnected } = useAccount();
  const { connectAsync } = useConnect();
  const { disconnect } = useDisconnect();
  const { signMessageAsync } = useSignMessage();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function handleSignIn() {
    setBusy(true);
    try {
      let acc = address;
      if (!isConnected) {
        const result = await connectAsync({ connector: injected() });
        acc = result.accounts[0];
      }
      if (!acc) throw new Error("no account");

      const nonceRes = await fetch("/api/auth/siwe/nonce", { method: "POST" });
      const { nonce } = await nonceRes.json();

      const msg = new SiweMessage({
        domain: window.location.host,
        address: acc,
        statement: "Sign in to Arc FX Gateway",
        uri: window.location.origin,
        version: "1",
        chainId: 5042002,
        nonce,
      });
      const message = msg.prepareMessage();
      const signature = await signMessageAsync({ message });

      const verify = await fetch("/api/auth/siwe/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message, signature }),
      });
      if (!verify.ok) throw new Error("verify failed");

      router.push("/m/dashboard");
    } catch (e: any) {
      toast.error(e?.message ?? "Sign-in failed");
      disconnect();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button onClick={handleSignIn} disabled={busy} className="btn-cb-pill">
      {busy ? "Signing in…" : "Connect wallet"}
    </button>
  );
}
