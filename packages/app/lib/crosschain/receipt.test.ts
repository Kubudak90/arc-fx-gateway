import { describe, expect, it } from "vitest";
import { encodeFunctionData } from "viem";
import {
  TOKEN_MESSENGER_ABI,
  verifySourceBurnTx,
  type SourceReceiptClient,
} from "./receipt";

const payer = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const burnToken = "0x5555555555555555555555555555555555555555";
const mintRecipient = `0x${"0".repeat(24)}${"9".repeat(40)}` as const;
const messenger = "0x3333333333333333333333333333333333333333";

function client(amount: bigint): SourceReceiptClient {
  return {
    getTransaction: async () => ({
      from: payer,
      to: messenger,
      input: encodeFunctionData({
        abi: TOKEN_MESSENGER_ABI,
        functionName: "depositForBurn",
        args: [
          amount,
          30,
          mintRecipient,
          burnToken,
          `0x${"0".repeat(64)}`,
          0n,
          2000,
        ],
      }),
    }),
    getTransactionReceipt: async () => ({
      status: "success",
      blockNumber: 123n,
    }),
  };
}

describe("verifySourceBurnTx", () => {
  it("accepts a burn fully bound to the stored intent", async () => {
    await expect(verifySourceBurnTx({
      sourceChainId: 84532,
      burnTxHash: `0x${"b".repeat(64)}`,
      expectedPayer: payer,
      expectedAmount: 5_000_000n,
      expectedDestinationDomain: 30,
      expectedMintRecipient: mintRecipient,
      expectedBurnToken: burnToken,
      client: client(5_000_000n),
    })).resolves.toEqual({ ok: true, blockNumber: 123n });
  });

  it("rejects a transaction whose calldata amount differs from the intent", async () => {
    await expect(verifySourceBurnTx({
      sourceChainId: 84532,
      burnTxHash: `0x${"b".repeat(64)}`,
      expectedPayer: payer,
      expectedAmount: 5_000_000n,
      expectedDestinationDomain: 30,
      expectedMintRecipient: mintRecipient,
      expectedBurnToken: burnToken,
      client: client(4_999_999n),
    })).rejects.toThrow("burn_tx_wrong_amount");
  });
});
