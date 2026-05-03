import { keccak256, toBytes, type Address, type Hex } from "viem";

/**
 * Server-side mirror of the SDK's witness derivation in
 * `lib/checkout/permit2.ts` and `components/checkout/PayButtonV8.tsx`.
 * Used by `/api/checkout/submit` to verify the witness the customer signed
 * binds the invoice to *our* relayer — preventing griefers from submitting
 * Permit2 messages for arbitrary witnesses against a public invoice id.
 */

export const ARCORA_WITNESS_TYPE_STRING =
  "ArcoraSwapIntent(bytes32 invoiceId,address relayer)";

const WITNESS_TYPE_HASH = keccak256(toBytes(ARCORA_WITNESS_TYPE_STRING));

export function expectedWitnessHash(invoiceId: Hex, relayer: Address): Hex {
  // abi.encode(typeHash, invoiceId, address) = 32 bytes each, address left-padded.
  const padded = relayer.slice(2).toLowerCase().padStart(64, "0");
  const packed = (
    "0x" + WITNESS_TYPE_HASH.slice(2) + invoiceId.slice(2).toLowerCase() + padded
  ) as Hex;
  return keccak256(packed);
}
