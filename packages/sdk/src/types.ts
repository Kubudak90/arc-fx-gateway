export type Environment = "testnet" | "mainnet";
export type PayInToken = "USDC" | "EURC";
/** v2 payout currencies (the buyer always locks USDC; currency is the merchant payout). */
export type Currency = "USDC" | "EURC" | "USDT";

export interface Invoice {
  invoiceId: string;
  url: string;
  /** ISO-8601 timestamp after which the merchant can claim funds (V10 escrow model). */
  claimableAt?: string | null;
}

export interface EscrowSummary {
  id:          string;
  amountOut:   string;
  payoutToken: string;
  claimableAt: string | null;
  status:      "paid" | "claimed";
}

/**
 * Invoice creation params. v2 fields (`amount` decimal string + `currency` +
 * `idempotencyKey`) are preferred; the v1 fields (`amountUsdc` + `payInToken`)
 * remain for back-compat while the chain-agnostic router rolls out. Supply
 * exactly one amount form — the SDK sends v2 when `amount` is present, else v1.
 */
export interface CreateInvoiceParams {
  /** v2: amount as a DECIMAL STRING in major units (e.g. "49.99"). No floats. */
  amount?: string;
  /** v2: merchant payout currency (default USDC). */
  currency?: Currency;
  /** v2: idempotency key — a retried create never duplicates (Idempotency-Key header). */
  idempotencyKey?: string;
  /** @deprecated v1: use `amount` (string). The buyer always locks USDC in v2. */
  amountUsdc?: number;
  /** @deprecated v1: the buyer always locks USDC in v2; this is ignored on the v2 path. */
  payInToken?: PayInToken;
  successUrl: string;
  cancelUrl?: string;
  metadata?: Record<string, string>;
}

export interface InitOptions {
  apiKey: string;
  environment?: Environment;
  baseUrl?: string;
}
