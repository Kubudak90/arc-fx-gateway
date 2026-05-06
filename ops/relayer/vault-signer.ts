import { toAccount } from "viem/accounts";
import {
  type Hex,
  type SignableMessage,
  type TypedDataDefinition,
  hashMessage,
  hashTypedData,
  keccak256,
  serializeTransaction,
  publicKeyToAddress,
} from "viem";

export interface VaultSignerOpts {
  vaultUrl:  string;   // e.g. http://127.0.0.1:8200
  roleId:    string;   // VAULT_ROLE_ID
  secretId:  string;   // VAULT_SECRET_ID (rotated daily)
  keyName:   string;   // VAULT_KEY_NAME (typ. relayer-v10)
}

interface Session { token: string; expiresAt: number }

export async function vaultSigner(opts: VaultSignerOpts) {
  let session = await login(opts);

  async function ensureSession() {
    if (Date.now() < session.expiresAt - 5 * 60_000) return;
    session = await login(opts);
  }

  const pubkey = await fetchPublicKey(opts.vaultUrl, session.token, opts.keyName);
  const address = publicKeyToAddress(pubkey);

  return toAccount({
    address,

    async signMessage({ message }: { message: SignableMessage }) {
      await ensureSession();
      return await signDigest(opts, session.token, hashMessage(message));
    },

    async signTransaction(tx: any) {
      await ensureSession();
      const serialized = serializeTransaction(tx);
      const digest = keccak256(serialized);
      const signature = await signDigest(opts, session.token, digest);
      return serializeTransaction(tx, parseSignature(signature));
    },

    async signTypedData(typedData: TypedDataDefinition) {
      await ensureSession();
      return await signDigest(opts, session.token, hashTypedData(typedData));
    },
  });
}

async function login(opts: VaultSignerOpts): Promise<Session> {
  const res = await fetch(`${opts.vaultUrl}/v1/auth/approle/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ role_id: opts.roleId, secret_id: opts.secretId }),
  });
  if (!res.ok) throw new Error(`Vault login failed: ${res.status} ${await res.text()}`);
  const json = await res.json() as { auth: { client_token: string; lease_duration: number } };
  return {
    token:     json.auth.client_token,
    expiresAt: Date.now() + json.auth.lease_duration * 1000,
  };
}

async function fetchPublicKey(vaultUrl: string, token: string, keyName: string): Promise<Hex> {
  const res = await fetch(`${vaultUrl}/v1/transit/keys/${encodeURIComponent(keyName)}`, {
    headers: { "X-Vault-Token": token },
  });
  if (!res.ok) throw new Error(`Vault key read failed: ${res.status}`);
  const json = await res.json() as { data: { keys: Record<string, { public_key?: string }> } };
  const latest = Object.keys(json.data.keys).sort((a, b) => Number(b) - Number(a))[0];
  const raw = json.data.keys[latest]?.public_key;
  if (!raw) throw new Error("Vault key has no public_key field");
  // Plugin returns 0x04-prefixed uncompressed sec1; viem expects same.
  return raw.startsWith("0x") ? (raw as Hex) : (`0x${raw}` as Hex);
}

async function signDigest(
  opts:   VaultSignerOpts,
  token:  string,
  digest: Hex,
): Promise<Hex> {
  const res = await fetch(`${opts.vaultUrl}/v1/transit/sign/${encodeURIComponent(opts.keyName)}`, {
    method: "POST",
    headers: { "X-Vault-Token": token, "Content-Type": "application/json" },
    body: JSON.stringify({
      input:        Buffer.from(digest.slice(2), "hex").toString("base64"),
      prehashed:    true,
      marshaling_algorithm: "asn1",  // or "jws" depending on plugin config
    }),
  });
  if (!res.ok) throw new Error(`Vault sign failed: ${res.status} ${await res.text()}`);
  const json = await res.json() as { data: { signature: string } };
  // Plugin returns "vault:v1:<base64-sig>"; strip prefix and convert to 0x-hex.
  const sigB64 = json.data.signature.split(":").pop()!;
  const sig = Buffer.from(sigB64, "base64").toString("hex");
  return `0x${sig}` as Hex;
}

function parseSignature(sig: Hex) {
  // r (32) || s (32) || v (1)
  const hex = sig.slice(2);
  return {
    r: `0x${hex.slice(0, 64)}` as Hex,
    s: `0x${hex.slice(64, 128)}` as Hex,
    v: BigInt(parseInt(hex.slice(128, 130), 16)),
  };
}
