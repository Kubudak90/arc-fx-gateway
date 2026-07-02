import { useCheckout } from "./useCheckout";
import type { CreateInvoiceParams, InitOptions } from "@arcora/sdk";

/**
 * Props for the drop-in checkout button.
 *
 * SECURITY: `apiKey` here MUST be your publishable key (`pk_live_…`).
 * Secret keys (`ak_…`) throw at construction time in browser contexts
 * (SDK ≥ 1.3.0). Never pass a secret key to a React component.
 */
export interface CheckoutButtonProps extends InitOptions {
  invoice: CreateInvoiceParams;
  children?: React.ReactNode;
  className?: string;
}

export function CheckoutButton({ apiKey, environment, baseUrl, invoice, children, className }: CheckoutButtonProps) {
  const { checkout, loading, error } = useCheckout({ apiKey, environment, baseUrl });
  return (
    <>
      {/* useCheckout records the error in state before re-throwing, so swallowing the rejection
          here is safe and prevents an unhandled promise rejection from the floating checkout(). */}
      <button
        onClick={() => { void checkout(invoice).catch(() => {}); }}
        disabled={loading}
        className={className}
      >
        {children ?? (loading ? "Loading..." : "Pay")}
      </button>
      {error && <span role="alert">{error.message}</span>}
    </>
  );
}
