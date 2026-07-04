// packages/agent-commerce-cli/src/lib/gas.ts
export interface WaitForGasOpts {
  getBalance: () => Promise<bigint>;
  floor: bigint;
  onNeedFunds: () => void; // called once when funding is required (e.g. print faucet URL)
  pollMs: number;
  maxPolls: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function waitForGas(opts: WaitForGasOpts): Promise<void> {
  if ((await opts.getBalance()) >= opts.floor) return;
  opts.onNeedFunds();
  for (let i = 0; i < opts.maxPolls; i++) {
    await sleep(opts.pollMs);
    if ((await opts.getBalance()) >= opts.floor) return;
  }
  throw new Error("gas_timeout: wallet not funded with Arc gas in time");
}
