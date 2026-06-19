"use client";

import { Coin } from "@/components/ui/Coin";

const DEFAULT_CHAINS: readonly { chainId: number; label: string }[] = [
  { chainId: 84532, label: "Base Sepolia" },
  { chainId: 11155111, label: "Ethereum Sepolia" },
];

export function ChainSelector(props: {
  value: number;
  onChange: (chainId: number) => void;
  /** Override the pay-from chain list (v2 passes the registry-driven chains). */
  chains?: readonly { chainId: number; label: string }[];
}) {
  const chains = props.chains ?? DEFAULT_CHAINS;
  return (
    <div className="space-y-2">
      <span className="eyebrow">Pay from</span>
      <div role="radiogroup" aria-label="Source chain" className="flex flex-wrap gap-2">
        {chains.map((chain) => {
          const selected = props.value === chain.chainId;
          return (
            <button
              key={chain.chainId}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => props.onChange(chain.chainId)}
              className="field inline-flex items-center gap-2 rounded-full px-3.5 py-2 cursor-pointer transition-colors"
              style={{
                borderColor: selected ? "var(--acc)" : "var(--border)",
                background: selected ? "var(--acc-soft)" : "var(--surface-2)",
              }}
            >
              <Coin sym="USDC" />
              <span className="text-[13px] font-semibold text-[var(--fg-1)]">{chain.label}</span>
              {selected && (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function chainLabel(chainId: number): string {
  return DEFAULT_CHAINS.find((chain) => chain.chainId === chainId)?.label ?? `chain ${chainId}`;
}
