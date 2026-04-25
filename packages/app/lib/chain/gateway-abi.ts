import { parseAbi } from "viem";

export const GATEWAY_ABI = parseAbi([
  "function createInvoiceFor(address merchant, bytes32 id, address payIn, uint256 amountOut, uint64 expiresAt) external",
  "function authorizeDelegate(address delegate, uint64 expiresAt) external",
  "function revokeDelegate(address delegate) external",
  "function registerMerchant(address payoutToken) external",
  "function pay(bytes32 id, uint256 maxAmountIn) external",
  "function withdrawFees(address token, address to) external",
  "function merchants(address) view returns (address payoutToken, bool registered)",
  "function invoices(bytes32) view returns (address merchant, address payIn, uint256 amountOut, uint64 expiresAt, uint8 status, address paidBy)",
  "function delegateAuthorizations(address merchant, address delegate) view returns (uint64)",
  "event MerchantRegistered(address indexed merchant, address payoutToken)",
  "event InvoiceCreated(bytes32 indexed id, address indexed merchant, address payIn, uint256 amountOut, uint64 expiresAt)",
  "event InvoicePaid(bytes32 indexed id, address indexed payer, uint256 amountIn, uint256 amountOut, uint256 fee)",
  "event DelegateAuthorized(address indexed merchant, address indexed delegate, uint64 expiresAt)",
  "event DelegateRevoked(address indexed merchant, address indexed delegate)",
]);
