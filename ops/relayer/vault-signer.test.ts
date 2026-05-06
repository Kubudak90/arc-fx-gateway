// Run with: pnpm --filter @arcora/ops exec vitest run ops/relayer/vault-signer.test.ts
//
// Pre-req: a local Vault dev-mode instance with the secp256k1 plugin and
// a key called `test-relayer`. Skipped in CI; run manually on a dev box.
//
//   vault server -dev -dev-root-token-id=root &
//   VAULT_ADDR=http://127.0.0.1:8200 VAULT_TOKEN=root \
//     vault secrets enable -path=transit -plugin-name=vault-plugin-secrets-secp256k1 plugin
//   VAULT_ADDR=… vault write -f transit/keys/test-relayer type=secp256k1 exportable=false
//   VAULT_ADDR=… vault auth enable approle
//   …  (see ops/vault/README.md for the full ceremony — abbreviated for tests)

import { describe, it, expect } from "vitest";
import { hashMessage, recoverMessageAddress } from "viem";
import { vaultSigner } from "./vault-signer";

const enabled = process.env.VAULT_DEV === "1";
const itOnDev = enabled ? it : it.skip;

describe("vault-signer", () => {
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
