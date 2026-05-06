import { toAccount, publicKeyToAddress } from "viem/accounts";
import {
  type Hex,
  type SignableMessage,
  type LocalAccount,
  hashMessage,
  hashTypedData,
  keccak256,
  serializeTransaction,
  recoverAddress,
} from "viem";
import { secp256k1 } from "@noble/curves/secp256k1";

export interface VaultSignerOpts {
  vaultUrl:  string;   // e.g. http://127.0.0.1:8200
  roleId:    string;   // VAULT_ROLE_ID
  secretId:  string;   // VAULT_SECRET_ID (rotated daily)
  keyName:   string;   // VAULT_KEY_NAME (typ. relayer-v10)
}

interface Session { token: string; expiresAt: number }

export async function vaultSigner(opts: VaultSignerOpts): Promise<LocalAccount> {
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
      const digest = hashMessage(message);
      const derHex = await signDigest(opts, session.token, digest);
      return serializeSignatureEip155(digest, address, derHex);
    },

    async signTransaction(tx: Parameters<LocalAccount["signTransaction"]>[0]) {
      await ensureSession();
      const serialized = serializeTransaction(tx as Parameters<typeof serializeTransaction>[0]);
      const digest = keccak256(serialized);
      const derHex = await signDigest(opts, session.token, digest);
      const { r, s, v } = await parseDerToRSV(digest, address, derHex);
      return serializeTransaction(
        tx as Parameters<typeof serializeTransaction>[0],
        { r, s, v },
      ) as `0x${string}`;
    },

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async signTypedData(typedData: any) {
      await ensureSession();
      const digest = hashTypedData(typedData);
      const derHex = await signDigest(opts, session.token, digest);
      return serializeSignatureEip155(digest, address, derHex);
    },
  }) as LocalAccount;
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

/**
 * Call Vault transit/sign with marshaling_algorithm=asn1 (default for secp256k1 plugin).
 * Returns the DER-encoded signature bytes as a 0x-prefixed hex string.
 * Vault returns "vault:v1:<base64-DER>"; this function strips the prefix.
 */
async function signDigest(
  opts:   VaultSignerOpts,
  token:  string,
  digest: Hex,
): Promise<Hex> {
  const res = await fetch(`${opts.vaultUrl}/v1/transit/sign/${encodeURIComponent(opts.keyName)}`, {
    method: "POST",
    headers: { "X-Vault-Token": token, "Content-Type": "application/json" },
    body: JSON.stringify({
      input:     Buffer.from(digest.slice(2), "hex").toString("base64"),
      prehashed: true,
      // Vault secp256k1 plugin returns ASN.1 DER SEQUENCE { INTEGER r, INTEGER s }
      // (~70-72 bytes, variable length). Not a raw 65-byte r||s||v blob.
      marshaling_algorithm: "asn1",
    }),
  });
  if (!res.ok) throw new Error(`Vault sign failed: ${res.status} ${await res.text()}`);
  const json = await res.json() as { data: { signature: string } };
  // Plugin returns "vault:v1:<base64-DER>"; strip the prefix and decode.
  const sigB64 = json.data.signature.split(":").pop()!;
  const derHex = Buffer.from(sigB64, "base64").toString("hex");
  return `0x${derHex}` as Hex;
}

/**
 * Parse a Vault ASN.1 DER-encoded secp256k1 signature and recover the Ethereum
 * recovery bit (v ∈ {27, 28}).
 *
 * Vault's transit engine returns raw DER (SEQUENCE { INTEGER r, INTEGER s }),
 * NOT a 65-byte r||s||v blob. The recovery bit is not included — we derive it
 * by trying v=27 first; if the recovered address doesn't match, we use v=28.
 *
 * The function also enforces low-S canonicality: Vault signs with low-S by
 * default, but we normalise defensively.
 *
 * Exported for unit testing with synthetic DER fixtures.
 */
export async function parseDerToRSV(
  digest:  Hex,
  address: Hex,
  derHex:  Hex,
): Promise<{ r: Hex; s: Hex; v: bigint }> {
  const derBytes = Uint8Array.from(Buffer.from(derHex.slice(2), "hex"));
  // secp256k1.Signature.fromDER handles both 70- and 72-byte DER envelopes.
  const sig = secp256k1.Signature.fromDER(derBytes).normalizeS();

  const r = `0x${sig.r.toString(16).padStart(64, "0")}` as Hex;
  const s = `0x${sig.s.toString(16).padStart(64, "0")}` as Hex;

  for (const v of [27n, 28n]) {
    const recovered = await recoverAddress({ hash: digest, signature: { r, s, v } });
    if (recovered.toLowerCase() === address.toLowerCase()) return { r, s, v };
  }
  throw new Error("vault-signer: cannot recover v — neither candidate matches address");
}

/**
 * Parse DER, recover v, and return the full EIP-155 65-byte hex signature
 * (r||s||v, with v=0x1b or 0x1c) for use in signMessage / signTypedData.
 */
async function serializeSignatureEip155(
  digest:  Hex,
  address: Hex,
  derHex:  Hex,
): Promise<Hex> {
  const { r, s, v } = await parseDerToRSV(digest, address, derHex);
  // Concatenate as 65-byte hex: r (32) || s (32) || v (1)
  return `${r}${s.slice(2)}${v === 27n ? "1b" : "1c"}` as Hex;
}
