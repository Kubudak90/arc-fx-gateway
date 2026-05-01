"use client";

import { useEffect, useState } from "react";
import {
  useAccount, usePublicClient, useChainId, useSignTypedData, useWriteContract,
} from "wagmi";
import { keccak256, parseAbi, toBytes, type Address, type Hex } from "viem";
import { toast } from "sonner";
import { Check, Info, Loader2 } from "lucide-react";
import { mapChainError } from "@/lib/chain/error-mapper";
import { buildArcoraSwapIntent, randomNonce, PERMIT2_ADDRESS } from "@arcora/sdk";

const ERC20_ABI = parseAbi([
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
]);

interface PayButtonV8Props {
  invoiceId:         string;
  payInTokenAddress: Address;
  payInAmount:       bigint | null;
  /** Stops the pay button when the displayed quote is past TTL — customer
   *  should refresh the QuoteDisplay first. */
  quoteStale:        boolean;
  onPaid:            (settleTxHash: Hex) => void;
  onFailed?:         (reason: string) => void;
}

type State =
  | "idle"
  | "checking_allowance"
  | "approving_permit2"
  | "signing"
  | "submitting"
  | "settling"
  | "success"
  | "failed";

export function PayButtonV8(props: PayButtonV8Props) {
  const { address } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const { signTypedDataAsync } = useSignTypedData();
  const { writeContractAsync } = useWriteContract();

  const [state, setState] = useState<State>("idle");
  const [statusUrl, setStatusUrl] = useState<string | null>(null);
  const [settleTx, setSettleTx]   = useState<Hex | null>(null);
  const [needsPermit2Setup, setNeedsPermit2Setup] = useState<boolean | null>(null);

  const arcId = 5042002;
  const relayerAddress = process.env.NEXT_PUBLIC_RELAYER_ADDRESS as Address | undefined;

  // Pre-check Permit2 allowance on connect so first-time customers see a
  // banner explaining the one-time approval tx, instead of an unannounced
  // popup the moment they click Pay. Cleared once approval lands.
  useEffect(() => {
    if (!address || !publicClient) {
      setNeedsPermit2Setup(null);
      return;
    }
    publicClient.readContract({
      address: props.payInTokenAddress,
      abi: ERC20_ABI,
      functionName: "allowance",
      args: [address, PERMIT2_ADDRESS],
    }).then((current) => {
      setNeedsPermit2Setup((current as bigint) < (1n << 255n));
    }).catch(() => setNeedsPermit2Setup(null));
  }, [address, publicClient, props.payInTokenAddress, state]);

  async function ensurePermit2Allowance() {
    setState("checking_allowance");
    const current = await publicClient!.readContract({
      address: props.payInTokenAddress,
      abi: ERC20_ABI,
      functionName: "allowance",
      args: [address!, PERMIT2_ADDRESS],
    });
    // Permit2 only needs to be approved once per token per wallet — after
    // that, every transfer is signature-only. Only re-approve if the
    // allowance is below uint256.max / 2 (which means it's been spent down
    // or never set).
    if (current >= (1n << 255n)) return;

    setState("approving_permit2");
    const tx = await writeContractAsync({
      address: props.payInTokenAddress,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [PERMIT2_ADDRESS, (1n << 256n) - 1n],
    });
    await publicClient!.waitForTransactionReceipt({ hash: tx });
    // Tiny settle so the next read sees the new allowance — some RPCs lag.
    await new Promise(r => setTimeout(r, 600));
  }

  async function signAndSubmit(): Promise<string> {
    const nonce    = randomNonce();
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 5 * 60); // 5 min sig TTL

    const { typedData, witnessForBackend } = buildArcoraSwapIntent({
      chainId:    arcId,
      payInToken: props.payInTokenAddress,
      amount:     props.payInAmount!,
      relayer:    relayerAddress!,
      invoiceId:  props.invoiceId as `0x${string}`,
      deadline,
      nonce,
    });

    setState("signing");
    // wagmi's signTypedDataAsync generic infers from the literal `types`
    // shape; our SDK builder returns a precise type that fights the generic.
    // Cast at the call boundary — the underlying viem call is happy with
    // the runtime shape regardless.
    const signature = await signTypedDataAsync(typedData as Parameters<typeof signTypedDataAsync>[0]);

    setState("submitting");
    const res = await fetch("/api/checkout/submit", {
      method:  "POST",
      headers: { "content-type": "application/json" },
      body:    JSON.stringify({
        invoiceId:        props.invoiceId,
        payer:            address!,
        payInToken:       props.payInTokenAddress,
        amountIn:         props.payInAmount!.toString(),
        permit2Data: {
          nonce:             witnessForBackend.nonce,
          deadline:          witnessForBackend.deadline,
          // Backend re-derives the witness hash from the components plus
          // the type hash. We send only the components — keeps the wire
          // payload small and avoids round-trip mismatches.
          witness:           deriveWitnessHashClient(witnessForBackend.witnessComponents),
          witnessTypeString: witnessForBackend.witnessTypeString,
        },
        permit2Signature: signature,
      }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? `submit failed: ${res.status}`);
    return body.statusUrl as string;
  }

  async function pollUntilTerminal(url: string): Promise<{ status: string; settleTxHash?: string; error?: string }> {
    const max = 24; // 24 × 5s = 2 min
    for (let i = 0; i < max; i++) {
      const r = await fetch(url);
      const data = await r.json();
      if (["settled", "refunded", "failed"].includes(data.status)) {
        return data;
      }
      await new Promise(rs => setTimeout(rs, 5000));
    }
    throw new Error("timed out waiting for settlement");
  }

  async function handleClick() {
    if (!address || !props.payInAmount) return;
    if (chainId !== arcId) {
      toast.error("Switch to Arc Testnet to continue");
      return;
    }
    if (!relayerAddress) {
      toast.error("Relayer address not configured");
      return;
    }
    if (props.quoteStale) {
      toast.error("Quote expired — refresh and try again");
      return;
    }

    try {
      await ensurePermit2Allowance();
      const url = await signAndSubmit();
      setStatusUrl(url);
      setState("settling");
      const terminal = await pollUntilTerminal(url);
      if (terminal.status === "settled" && terminal.settleTxHash) {
        setSettleTx(terminal.settleTxHash as Hex);
        setState("success");
        props.onPaid(terminal.settleTxHash as Hex);
      } else if (terminal.status === "refunded") {
        setState("failed");
        const reason = "Swap failed — your funds have been returned.";
        toast.error(reason);
        props.onFailed?.(reason);
      } else {
        setState("failed");
        const reason = terminal.error ?? `Settlement failed (${terminal.status})`;
        toast.error(reason);
        props.onFailed?.(reason);
      }
    } catch (e) {
      setState("failed");
      toast.error(mapChainError(e));
    }
  }

  const label: Record<State, string> = {
    idle:                "Pay with one signature",
    checking_allowance:  "Checking allowance…",
    approving_permit2:   "Approving Permit2…",
    signing:             "Sign in your wallet…",
    submitting:          "Submitting…",
    settling:            "Settling on-chain…",
    success:             "Paid ✓",
    failed:              "Retry",
  };

  const inFlight = state !== "idle" && state !== "success" && state !== "failed";
  const showProgress = inFlight || state === "success";

  return (
    <div className="space-y-3">
      {needsPermit2Setup && state === "idle" && (
        <div className="rounded-lg border border-arcora-border bg-arcora-gray/30 p-3 flex items-start gap-2 text-xs">
          <Info className="size-4 mt-0.5 flex-none text-arcora-blue" />
          <div>
            <div className="font-semibold mb-0.5">First-time wallet setup</div>
            You&apos;ll see two prompts the first time: one wallet approval to Permit2 (one-time per token, costs ~$0.05 USDC in gas), then a gas-less signature. Subsequent payments only need the signature.
          </div>
        </div>
      )}

      <button
        onClick={handleClick}
        disabled={!address || !props.payInAmount || inFlight || state === "success" || props.quoteStale}
        className="btn-arcora-pill w-full"
      >
        {label[state]}
      </button>

      {showProgress && <ProgressList state={state} />}

      {settleTx && (
        <a
          href={`https://testnet.arcscan.app/tx/${settleTx}`}
          target="_blank"
          rel="noopener noreferrer"
          className="block text-center text-xs text-arcora-link hover:underline"
        >
          View settlement →
        </a>
      )}
    </div>
  );
}

const STEPS: { key: State[]; label: string }[] = [
  { key: ["checking_allowance", "approving_permit2"], label: "Wallet setup" },
  { key: ["signing"],                                 label: "Sign authorization" },
  { key: ["submitting"],                              label: "Submit to relayer" },
  { key: ["settling"],                                label: "Swap and settle on-chain" },
];

function ProgressList({ state }: { state: State }) {
  // A step is "active" if state matches; "done" if a later step is active
  // OR we've reached terminal success. Permit2 setup is shown only when
  // the user is mid-approval — for second-time payers it gets skipped over
  // by `state` jumping straight from idle to signing.
  const order = ["idle", "checking_allowance", "approving_permit2", "signing", "submitting", "settling", "success", "failed"];
  const idx   = order.indexOf(state);

  return (
    <ul className="space-y-1.5 text-xs">
      {STEPS.filter(s => s.key[0] !== "checking_allowance" || idx >= order.indexOf("approving_permit2")).map((step) => {
        const stepIdx = Math.max(...step.key.map(k => order.indexOf(k)));
        const done    = idx > stepIdx || state === "success";
        const active  = step.key.includes(state);
        return (
          <li key={step.label} className="flex items-center gap-2">
            {done ? (
              <Check className="size-4 text-emerald-600" />
            ) : active ? (
              <Loader2 className="size-4 text-arcora-blue animate-spin" />
            ) : (
              <span className="size-4 rounded-full border border-arcora-border" />
            )}
            <span className={done ? "text-muted-foreground line-through" : active ? "font-medium" : "text-muted-foreground"}>
              {step.label}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Mirror of the on-chain witness derivation. The contract recomputes
 * `keccak256(abi.encode(typeHash, invoiceId, relayer))` to validate the
 * signed message; we precompute the same value here so the server route
 * can pass it straight to `Permit2.permitWitnessTransferFrom`.
 */
function deriveWitnessHashClient(c: { invoiceId: `0x${string}`; relayer: `0x${string}` }): `0x${string}` {
  const typeHash = keccak256(toBytes("ArcoraSwapIntent(bytes32 invoiceId,address relayer)"));
  // abi.encode for (bytes32, bytes32, address) is just left-padded 32-byte
  // concatenation. Match that layout so the on-chain witness hash agrees
  // with what we're computing client-side.
  const padAddr = ("0x" + c.relayer.slice(2).toLowerCase().padStart(64, "0")) as `0x${string}`;
  const packed = ("0x" + typeHash.slice(2) + c.invoiceId.slice(2) + padAddr.slice(2)) as `0x${string}`;
  return keccak256(packed);
}
