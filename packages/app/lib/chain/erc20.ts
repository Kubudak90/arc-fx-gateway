import { type Address, parseAbi } from "viem";
import { publicClient } from "@/lib/chain/client";

const ERC20_ALLOWANCE_ABI = parseAbi([
  "function allowance(address owner, address spender) view returns (uint256)",
  "function decimals() view returns (uint8)",
]);

export async function readAllowance(
  token: Address,
  owner: Address,
  spender: Address,
): Promise<bigint> {
  return publicClient.readContract({
    address: token,
    abi: ERC20_ALLOWANCE_ABI,
    functionName: "allowance",
    args: [owner, spender],
  }) as Promise<bigint>;
}

export async function readDecimals(token: Address): Promise<number> {
  return publicClient.readContract({
    address: token,
    abi: ERC20_ALLOWANCE_ABI,
    functionName: "decimals",
  }) as Promise<number>;
}
