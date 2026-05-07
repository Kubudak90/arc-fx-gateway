import { privateKeyToAccount } from "viem/accounts";
import type { Hex, LocalAccount } from "viem";

export interface VaultSignerOpts {
  vaultUrl:  string;   // e.g. http://127.0.0.1:8200
  roleId:    string;   // VAULT_ROLE_ID — long-lived
  secretId:  string;   // VAULT_SECRET_ID — rotated daily by ops/vault/secret-id-rotation.sh
  kvPath:    string;   // KV-v2 path, e.g. "secret/data/relayer-v10" (note: KV-v2 "data" prefix)
  kvField:   string;   // field within the secret, e.g. "privateKey"
}

/**
 * V10 relayer key isolation via Vault KV-v2 + AppRole.
 *
 * The relayer's private key lives in Vault's KV-v2 secret store (encrypted at
 * rest with Vault's master key). At boot, the relayer process AppRole-logs in,
 * fetches the key once, and uses viem's `privateKeyToAccount` for in-process
 * signing.
 *
 * Honest M1 partial-closure scope:
 *   - encrypted at rest in Vault (no plaintext in /etc/arcora/*.env)
 *   - access gated by AppRole secret_id rotated daily
 *   - every read audit-logged by Vault for forensic reconstruction
 *   - key still in relayer process memory after fetch (mitigated by short-lived
 *     process restarts on env-file rewrite; no key rotation needed mid-process)
 *
 * Plan 11 (mainnet T-0) will move to a signing-isolated HSM (AWS KMS Cloud HSM
 * or a vetted Vault transit secp256k1 plugin) where the key never leaves the
 * HSM boundary.
 */
export async function vaultSigner(opts: VaultSignerOpts): Promise<LocalAccount> {
  const token = await login(opts);
  const privateKey = await fetchPrivateKey(opts.vaultUrl, token, opts.kvPath, opts.kvField);
  return privateKeyToAccount(privateKey);
}

async function login(opts: VaultSignerOpts): Promise<string> {
  const res = await fetch(`${opts.vaultUrl}/v1/auth/approle/login`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ role_id: opts.roleId, secret_id: opts.secretId }),
  });
  if (!res.ok) throw new Error(`Vault login failed: ${res.status} ${await res.text()}`);
  const json = await res.json() as { auth: { client_token: string } };
  return json.auth.client_token;
}

async function fetchPrivateKey(
  vaultUrl: string,
  token:    string,
  kvPath:   string,
  kvField:  string,
): Promise<Hex> {
  const res = await fetch(`${vaultUrl}/v1/${kvPath}`, {
    headers: { "X-Vault-Token": token },
  });
  if (!res.ok) throw new Error(`Vault KV read failed: ${res.status} ${await res.text()}`);
  const json = await res.json() as { data: { data: Record<string, string> } };
  const raw = json.data?.data?.[kvField];
  if (!raw) throw new Error(`Vault KV secret '${kvPath}' has no field '${kvField}'`);
  const hex = raw.startsWith("0x") ? raw : `0x${raw}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error("Vault KV secret is not a 32-byte hex private key");
  }
  return hex as Hex;
}
