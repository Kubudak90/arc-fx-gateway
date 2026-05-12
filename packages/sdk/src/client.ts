import { ArcoraError } from "./error";
import type { CreateInvoiceParams, Invoice, EscrowSummary, InitOptions, Environment } from "./types";

const ENV_BASE_URL: Record<Environment, string> = {
  testnet: "https://checkout-staging.arcorapay.com",
  mainnet: "https://checkout.arcorapay.com",
};

// ── Module-private worker functions (single source of truth) ───────────────

function isHttp(u: string): boolean {
  try {
    const url = new URL(u);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch { return false; }
}

function resolveBaseUrl(opts: InitOptions): string {
  return opts.baseUrl ?? ENV_BASE_URL[opts.environment ?? "testnet"];
}

async function doCreateInvoice(opts: InitOptions, params: CreateInvoiceParams): Promise<Invoice> {
  if (!isHttp(params.successUrl)) {
    throw new ArcoraError("INVALID_URL", `successUrl must be http(s): got ${params.successUrl}`);
  }
  if (params.cancelUrl && !isHttp(params.cancelUrl)) {
    throw new ArcoraError("INVALID_URL", `cancelUrl must be http(s): got ${params.cancelUrl}`);
  }
  // Audit #38: server already rejects via Zod (positive number), but
  // catching invalid amounts client-side is cheaper, more actionable, and
  // closes the Infinity/NaN/negative paths that JSON.stringify would
  // otherwise serialise into nonsense ("null" for NaN/Infinity).
  if (typeof params.amountUsdc !== "number" || !Number.isFinite(params.amountUsdc) || params.amountUsdc <= 0) {
    throw new ArcoraError(
      "UNKNOWN",
      `amountUsdc must be a finite positive number, got ${String(params.amountUsdc)}`,
    );
  }

  let res: Response;
  try {
    res = await fetch(`${resolveBaseUrl(opts)}/api/invoices`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Arcora-Api-Key": opts.apiKey,
      },
      body: JSON.stringify(params),
    });
  } catch (e) {
    throw new ArcoraError("NETWORK", "request failed", { cause: e });
  }

  if (res.status === 401) throw new ArcoraError("INVALID_API_KEY", "API key rejected");
  if (res.status >= 500) {
    const ra = res.headers.get("retry-after");
    throw new ArcoraError("SERVER_ERROR", `server returned ${res.status}`, {
      retryAfter: ra ? Number(ra) : undefined,
    });
  }
  if (!res.ok) {
    throw new ArcoraError("UNKNOWN", `unexpected ${res.status}`);
  }

  const json = await res.json() as { invoiceId: string; url: string };
  return { invoiceId: json.invoiceId, url: json.url };
}

async function doEscrows(opts: InitOptions): Promise<{ pending: EscrowSummary[]; matured: EscrowSummary[]; claimed: EscrowSummary[]; }> {
  let res: Response;
  try {
    res = await fetch(`${resolveBaseUrl(opts)}/api/merchant/escrows`, {
      method: "GET",
      headers: {
        "content-type": "application/json",
        "X-Arcora-Api-Key": opts.apiKey,
      },
    });
  } catch (e) {
    throw new ArcoraError("NETWORK", "request failed", { cause: e });
  }

  if (res.status === 401) throw new ArcoraError("INVALID_API_KEY", "API key rejected");
  if (res.status >= 500) {
    const ra = res.headers.get("retry-after");
    throw new ArcoraError("SERVER_ERROR", `server returned ${res.status}`, {
      retryAfter: ra ? Number(ra) : undefined,
    });
  }
  if (!res.ok) {
    throw new ArcoraError("UNKNOWN", `unexpected ${res.status}`);
  }

  return res.json() as Promise<{ pending: EscrowSummary[]; matured: EscrowSummary[]; claimed: EscrowSummary[]; }>;
}

function doOpenCheckout(invoice: { url: string }): void {
  if (typeof window === "undefined") {
    throw new ArcoraError("UNKNOWN", "openCheckout requires a browser environment");
  }
  window.location.href = invoice.url;
}

// ── Hybrid class: instance API (new Arcora()) + static deprecated singleton ─

export class Arcora {
  constructor(public readonly options: InitOptions) {
    if (!options.apiKey) throw new ArcoraError("INVALID_API_KEY", "apiKey required");
  }

  async createInvoice(params: CreateInvoiceParams): Promise<Invoice> {
    return doCreateInvoice(this.options, params);
  }

  openCheckout(invoice: { url: string }): void {
    return doOpenCheckout(invoice);
  }

  async escrows(): Promise<{ pending: EscrowSummary[]; matured: EscrowSummary[]; claimed: EscrowSummary[]; }> {
    return doEscrows(this.options);
  }

  // ── Deprecated module-level singleton API (audit H6, 2026-05-05) ──────────
  // Kept for back-compat: CDN bundle, demo-merchant, marketing copy. Schedule
  // for removal in next major. Don't use in multi-tenant host apps.
  private static _opts: InitOptions | undefined;

  /** @deprecated Use `new Arcora({ apiKey })` — singleton is unsafe in multi-tenant apps. */
  static init(opts: InitOptions): void {
    Arcora._opts = opts;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const proc = (typeof globalThis !== "undefined" && (globalThis as any).process) || undefined;
    if (proc?.env?.NODE_ENV !== "production") {
      // eslint-disable-next-line no-console
      console.warn("[arcora] Arcora.init is deprecated; use `new Arcora(opts)`. Removed in next major.");
    }
  }

  /** @deprecated Use `new Arcora(opts).createInvoice(params)`. */
  static async createInvoice(params: CreateInvoiceParams): Promise<Invoice> {
    if (!Arcora._opts) throw new ArcoraError("UNKNOWN", "Arcora.init was not called");
    return doCreateInvoice(Arcora._opts, params);
  }

  /** @deprecated Use `new Arcora(opts).openCheckout(invoice)`. */
  static openCheckout(invoice: { url: string }): void {
    return doOpenCheckout(invoice);
  }

  /** @deprecated Use `new Arcora(opts).escrows()`. */
  static async escrows(): Promise<{ pending: EscrowSummary[]; matured: EscrowSummary[]; claimed: EscrowSummary[]; }> {
    if (!Arcora._opts) throw new ArcoraError("UNKNOWN", "Arcora.init was not called");
    return doEscrows(Arcora._opts);
  }
}
