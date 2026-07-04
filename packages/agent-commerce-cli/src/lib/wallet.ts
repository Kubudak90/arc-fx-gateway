// packages/agent-commerce-cli/src/lib/wallet.ts
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from "node:fs";
import { dirname } from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Account, Hex } from "viem";

export interface ResolvedWallet { account: Account; address: string; created: boolean; }

function normalize(key: string): Hex {
  const k = key.trim();
  return (k.startsWith("0x") ? k : `0x${k}`) as Hex;
}

/**
 * Resolve the merchant wallet: an explicit importKey wins (never persisted);
 * else load an existing keyfile; else generate a fresh key and persist it
 * (0600). The keyfile holds the merchant's earnings — the CLI warns the
 * operator to back it up.
 */
export function resolveWallet(opts: { keyfilePath: string; importKey?: string }): ResolvedWallet {
  if (opts.importKey) {
    const account = privateKeyToAccount(normalize(opts.importKey));
    return { account, address: account.address, created: false };
  }
  if (existsSync(opts.keyfilePath)) {
    const account = privateKeyToAccount(normalize(readFileSync(opts.keyfilePath, "utf8")));
    return { account, address: account.address, created: false };
  }
  const pk = generatePrivateKey();
  mkdirSync(dirname(opts.keyfilePath), { recursive: true });
  writeFileSync(opts.keyfilePath, pk, { mode: 0o600 });
  chmodSync(opts.keyfilePath, 0o600);
  const account = privateKeyToAccount(pk);
  return { account, address: account.address, created: true };
}
