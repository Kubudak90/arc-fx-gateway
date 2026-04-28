import { useCheckout } from "./useCheckout";
import type { CreateInvoiceParams, InitOptions } from "@arcora/sdk";

export interface CheckoutButtonProps extends InitOptions {
  invoice: CreateInvoiceParams;
  children?: React.ReactNode;
  className?: string;
}

export function CheckoutButton({ apiKey, environment, baseUrl, invoice, children, className }: CheckoutButtonProps) {
  const { checkout, loading } = useCheckout({ apiKey, environment, baseUrl });
  return (
    <button onClick={() => checkout(invoice)} disabled={loading} className={className}>
      {children ?? (loading ? "Loading..." : "Pay")}
    </button>
  );
}
