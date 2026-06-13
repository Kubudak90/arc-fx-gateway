"use client";

import { useAccount, useConnect, useDisconnect } from "wagmi";
import { injected, walletConnect } from "wagmi/connectors";
import { useState } from "react";
import { toast } from "sonner";

// Wallet connect for the hosted checkout. wagmi only — the payment itself
// (PayButton / CrossChainPayButton) signs via wagmi hooks, so the connect UI
// must establish the same wagmi connection. (Replaced thirdweb's ConnectButton,
// which required a NEXT_PUBLIC_THIRDWEB_CLIENT_ID that hard-threw "clientId or
// secretKey must be provided" at module load when unset — 2026-06-13.)
//
// injected() needs no config and covers browser wallets (MetaMask, Rabby,
// Coinbase extension, in-app dApp browsers). WalletConnect is offered only when
// NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID is set, so a missing project id degrades
// gracefully instead of surfacing a broken button.

type Method = "injected" | "walletconnect";

function truncate(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function CheckoutConnectButton() {
  const { address, isConnected } = useAccount();
  const { connectAsync } = useConnect();
  const { disconnect } = useDisconnect();
  const [busy, setBusy] = useState<Method | null>(null);

  const hasInjected =
    typeof window !== "undefined" &&
    typeof (window as { ethereum?: unknown }).ethereum !== "undefined";
  const wcProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "";

  async function connect(method: Method) {
    setBusy(method);
    try {
      const connector =
        method === "injected"
          ? injected()
          : walletConnect({ projectId: wcProjectId, showQrModal: true });
      await connectAsync({ connector });
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Could not connect wallet");
    } finally {
      setBusy(null);
    }
  }

  if (isConnected && address) {
    return (
      <div className="field flex items-center justify-between gap-2 px-4 py-3">
        <span className="mono text-[13px] text-[var(--fg-1)]">{truncate(address)}</span>
        <button
          type="button"
          onClick={() => disconnect()}
          className="text-[13px] text-[var(--action)] hover:underline"
        >
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col gap-2">
      {hasInjected && (
        <button
          type="button"
          onClick={() => connect("injected")}
          disabled={busy !== null}
          className="pill pill--acc w-full"
          style={{ background: "var(--acc)", color: "var(--acc-ink)" }}
        >
          {busy === "injected" ? "Connecting…" : "Connect wallet"}
        </button>
      )}
      {wcProjectId && (
        <button
          type="button"
          onClick={() => connect("walletconnect")}
          disabled={busy !== null}
          className={`${hasInjected ? "pill pill--ghost" : "pill pill--acc"} w-full`}
        >
          {busy === "walletconnect"
            ? "Waiting on wallet…"
            : hasInjected
              ? "Or scan with mobile / hardware wallet"
              : "Connect with WalletConnect"}
        </button>
      )}
      {!hasInjected && !wcProjectId && (
        <p className="text-center text-[13px] text-[var(--fg-3)] leading-[1.55]">
          No browser wallet detected. Open this page in your wallet app, or use
          “Pay with mobile wallet” below.
        </p>
      )}
    </div>
  );
}
