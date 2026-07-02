import { useCallback, useEffect, useMemo, useState } from "react";
import { Arcora, type CreateInvoiceParams, type Invoice, type InitOptions } from "@arcora/sdk";

export interface UseCheckoutResult {
  checkout: (params: CreateInvoiceParams) => Promise<Invoice>;
  loading: boolean;
  error: Error | null;
  /**
   * V10 merchant claim deadline, derived from the invoice's `claimableAt`.
   *
   * Audit #12: `checkout()` calls `createInvoice`, whose response is an *unpaid*
   * invoice (`{ invoiceId, url }`) — it never carries `claimableAt`, so after a
   * normal checkout this is `null`. The post-payment claim deadline is read from
   * `escrows()` / a paid-invoice read instead; this field only populates if a
   * create response ever includes `claimableAt` (forward-compatible).
   */
  refundEndsAt: Date | null;
}

export function useCheckout(opts: InitOptions): UseCheckoutResult {
  // Audit #23: `opts.environment` selects the default base URL (testnet vs
  // mainnet) when `opts.baseUrl` is unset, so a parent that swaps environments
  // mid-session must re-create the Arcora instance — otherwise the old URL
  // sticks. Include it in the dep array.
  //
  // Audit #13: the Arcora constructor throws synchronously for the two most
  // common misconfigurations — a missing apiKey, and a secret `ak_` key used in
  // a browser. That throw runs inside useMemo *during render*, outside checkout()'s
  // try/catch, so it would crash the React subtree (an unhandled render error)
  // instead of surfacing through `error` the way the README's `{error && …}`
  // pattern leads developers to expect. Construct defensively and route the
  // failure through the hook's error state.
  const { arcora, initError } = useMemo(() => {
    try {
      return { arcora: new Arcora(opts), initError: null as Error | null };
    } catch (e) {
      return { arcora: null as Arcora | null, initError: e as Error };
    }
  }, [opts.apiKey, opts.baseUrl, opts.environment]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(initError);
  const [invoice, setInvoice] = useState<Invoice | null>(null);

  // Keep `error` in sync when a deps change produces a new construction outcome
  // (e.g. the parent fixes a bad apiKey — clear the stale init error).
  useEffect(() => { setError(initError); }, [initError]);

  const checkout = useCallback(async (params: CreateInvoiceParams): Promise<Invoice> => {
    if (!arcora) {
      const err = initError ?? new Error("Arcora is not initialized");
      setError(err);
      throw err;
    }
    setLoading(true);
    setError(null);
    try {
      const inv = await arcora.createInvoice(params);
      setInvoice(inv);
      arcora.openCheckout(inv);
      return inv;
    } catch (e) {
      setError(e as Error);
      throw e;
    } finally {
      setLoading(false);
    }
  }, [arcora, initError]);

  return {
    checkout,
    loading,
    error,
    refundEndsAt: invoice?.claimableAt ? new Date(invoice.claimableAt) : null,
  };
}
