// Run with: pnpm --filter arcora-relayer exec vitest run vault-signer.test.ts
//
// Integration tests (itOnDev) require a local Vault dev-mode instance with
// the secp256k1 plugin and a key called `test-relayer`. Skipped in CI unless
// VAULT_DEV=1 is set.
//
//   vault server -dev -dev-root-token-id=root &
//   VAULT_ADDR=http://127.0.0.1:8200 VAULT_TOKEN=root \
//     vault secrets enable -path=transit -plugin-name=vault-plugin-secrets-secp256k1 plugin
//   VAULT_ADDR=… vault write -f transit/keys/test-relayer type=secp256k1 exportable=false
//   VAULT_ADDR=… vault auth enable approle
//   …  (see ops/vault/README.md for the full ceremony — abbreviated for tests)

import { describe, it, expect } from "vitest";
import { hashMessage, recoverMessageAddress, recoverAddress } from "viem";
import { publicKeyToAddress } from "viem/accounts";
import { secp256k1 } from "@noble/curves/secp256k1";
import { vaultSigner, parseDerToRSV } from "./vault-signer.js";

const enabled = process.env.VAULT_DEV === "1";
const itOnDev = enabled ? it : it.skip;

// ---------------------------------------------------------------------------
// Unit test: DER parse + v recovery — runs without VAULT_DEV=1
// Constructs a known DER fixture using @noble/curves and verifies the parser
// produces a signature whose recovered address matches the expected address.
// ---------------------------------------------------------------------------
describe("parseDerToRSV (offline unit test)", () => {
  it("parses ASN.1 DER and recovers the correct v byte", async () => {
    // Generate a deterministic test key (fixed seed for reproducibility)
    const privKey = new Uint8Array(32);
    privKey.fill(0xab); // arbitrary non-zero repeating pattern
    const pubKey  = secp256k1.getPublicKey(privKey, false); // uncompressed 04||x||y
    const address = publicKeyToAddress(`0x${Buffer.from(pubKey).toString("hex")}`);

    // Sign a known digest
    const digest = new Uint8Array(32);
    digest.fill(0x42);
    const digestHex = `0x${Buffer.from(digest).toString("hex")}` as `0x${string}`;

    // Produce a low-S DER signature (matches Vault's default behaviour)
    const nobleSig = secp256k1.sign(digest, privKey, { lowS: true });
    const derBytes = nobleSig.toDERRawBytes();
    const derHex   = `0x${Buffer.from(derBytes).toString("hex")}` as `0x${string}`;

    // parseDerToRSV should round-trip correctly
    const { r, s, v } = await parseDerToRSV(digestHex, address, derHex);

    // r and s must match the noble signature
    expect(BigInt(r)).toBe(nobleSig.r);
    expect(BigInt(s)).toBe(nobleSig.normalizeS().s);

    // v must be 27 or 28
    expect([27n, 28n]).toContain(v);

    // Recovered address must match the expected address
    const recovered = await recoverAddress({ hash: digestHex, signature: { r, s, v } });
    expect(recovered.toLowerCase()).toBe(address.toLowerCase());
  });

  it("handles both possible recovery candidates correctly", async () => {
    // Run 10 random trials to exercise both v=27 and v=28 cases
    for (let i = 0; i < 10; i++) {
      const privKey = secp256k1.utils.randomPrivateKey();
      const pubKey  = secp256k1.getPublicKey(privKey, false);
      const address = publicKeyToAddress(`0x${Buffer.from(pubKey).toString("hex")}`);

      const digest = crypto.getRandomValues(new Uint8Array(32));
      const digestHex = `0x${Buffer.from(digest).toString("hex")}` as `0x${string}`;

      const nobleSig = secp256k1.sign(digest, privKey, { lowS: true });
      const derHex   = `0x${Buffer.from(nobleSig.toDERRawBytes()).toString("hex")}` as `0x${string}`;

      const { r, s, v } = await parseDerToRSV(digestHex, address, derHex);
      const recovered = await recoverAddress({ hash: digestHex, signature: { r, s, v } });
      expect(recovered.toLowerCase()).toBe(address.toLowerCase());
    }
  });
});

// ---------------------------------------------------------------------------
// Integration tests: require VAULT_DEV=1 and a live Vault instance
// ---------------------------------------------------------------------------
describe("vault-signer (integration — skipped without VAULT_DEV=1)", () => {
  itOnDev("derives an Ethereum address from the transit public key", async () => {
    const account = await vaultSigner({
      vaultUrl:  "http://127.0.0.1:8200",
      roleId:    process.env.TEST_VAULT_ROLE_ID!,
      secretId:  process.env.TEST_VAULT_SECRET_ID!,
      keyName:   "test-relayer",
    });
    expect(account.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  itOnDev("signs a message and the signature recovers to the same address", async () => {
    const account = await vaultSigner({
      vaultUrl: "http://127.0.0.1:8200",
      roleId:   process.env.TEST_VAULT_ROLE_ID!,
      secretId: process.env.TEST_VAULT_SECRET_ID!,
      keyName:  "test-relayer",
    });
    const sig = await account.signMessage!({ message: "hello arcora" });
    const recovered = await recoverMessageAddress({ message: "hello arcora", signature: sig });
    expect(recovered.toLowerCase()).toEqual(account.address.toLowerCase());
  });
});
