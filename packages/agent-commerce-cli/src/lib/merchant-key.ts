// packages/agent-commerce-cli/src/lib/merchant-key.ts
//
// READ-ONLY resolution of the merchant private key for serve / refund. Unlike
// resolveWallet (which GENERATES a fresh key when none exists, for onboard),
// this never creates anything: it returns the env key if set, else the keyfile
// contents if the file exists, else undefined. The caller decides what to do
// when no key is available.
import { existsSync, readFileSync } from "node:fs";
import { MERCHANT_KEYFILE } from "../constants";

function normalize(key: string): `0x${string}` {
  const k = key.trim();
  return (k.startsWith("0x") ? k : `0x${k}`) as `0x${string}`;
}

/** Resolve the merchant key for serve/refund. env wins over the keyfile; never
 *  generates a key. Returns undefined when neither source is present. */
export function resolveMerchantKey(opts: {
  env?: Record<string, string | undefined>;
  keyfilePath?: string;
} = {}): `0x${string}` | undefined {
  const env = opts.env ?? process.env;
  const keyfilePath = opts.keyfilePath ?? MERCHANT_KEYFILE;

  const fromEnv = env.ARCORA_MERCHANT_KEY;
  if (fromEnv && fromEnv.trim()) return normalize(fromEnv);

  if (existsSync(keyfilePath)) {
    const contents = readFileSync(keyfilePath, "utf8");
    if (contents.trim()) return normalize(contents);
  }
  return undefined;
}
