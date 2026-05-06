import { useCallback, useMemo, useState } from "react";
import { Arcora, type CreateInvoiceParams, type Invoice, type InitOptions } from "@arcora/sdk";

export interface UseCheckoutResult {
  checkout: (params: CreateInvoiceParams) => Promise<Invoice>;
  loading: boolean;
  error: Error | null;
}

export function useCheckout(opts: InitOptions): UseCheckoutResult {
  const arcora = useMemo(() => new Arcora(opts), [opts.apiKey, opts.baseUrl]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const checkout = useCallback(async (params: CreateInvoiceParams): Promise<Invoice> => {
    setLoading(true);
    setError(null);
    try {
      const inv = await arcora.createInvoice(params);
      arcora.openCheckout(inv);
      return inv;
    } catch (e) {
      setError(e as Error);
      throw e;
    } finally {
      setLoading(false);
    }
  }, [arcora]);

  return { checkout, loading, error };
}
