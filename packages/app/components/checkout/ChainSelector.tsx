"use client";

const CHAINS = [
  { chainId: 84532, label: "Base Sepolia" },
  { chainId: 11155111, label: "Ethereum Sepolia" },
] as const;

export function ChainSelector(props: {
  value: number;
  onChange: (chainId: number) => void;
}) {
  return (
    <label className="block space-y-2">
      <span className="text-sm font-medium">Pay from</span>
      <select
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
        className="w-full border border-arcora-border bg-white px-3 py-2 text-sm"
      >
        {CHAINS.map((chain) => (
          <option key={chain.chainId} value={chain.chainId}>{chain.label}</option>
        ))}
      </select>
    </label>
  );
}

export function chainLabel(chainId: number): string {
  return CHAINS.find((chain) => chain.chainId === chainId)?.label ?? `chain ${chainId}`;
}
