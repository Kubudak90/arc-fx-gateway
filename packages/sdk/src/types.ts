export type Environment = "testnet" | "mainnet";
export type PayInToken = "USDC" | "EURC";

export interface Invoice {
  invoiceId: string;
  url: string;
}

export interface CreateInvoiceParams {
  amountUsdc: number;
  payInToken: PayInToken;
  successUrl: string;
  cancelUrl?: string;
  metadata?: Record<string, string>;
}

export interface InitOptions {
  apiKey: string;
  environment?: Environment;
  baseUrl?: string;
}
