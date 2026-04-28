import { ArcoraError } from "./error";
import type { CreateInvoiceParams, Invoice, InitOptions, Environment } from "./types";

const ENV_BASE_URL: Record<Environment, string> = {
  testnet: "https://checkout-staging.arcorapay.com",
  mainnet: "https://checkout.arcorapay.com",
};

let _opts: InitOptions | undefined;

function init(opts: InitOptions): void { _opts = opts; }
function getOpts(): InitOptions {
  if (!_opts) throw new ArcoraError("UNKNOWN", "Arcora.init was not called");
  return _opts;
}

function baseUrl(): string {
  const o = getOpts();
  return o.baseUrl ?? ENV_BASE_URL[o.environment ?? "testnet"];
}

function isHttp(u: string): boolean {
  try {
    const url = new URL(u);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch { return false; }
}

async function createInvoice(params: CreateInvoiceParams): Promise<Invoice> {
  if (!isHttp(params.successUrl)) {
    throw new ArcoraError("INVALID_URL", `successUrl must be http(s): got ${params.successUrl}`);
  }
  if (params.cancelUrl && !isHttp(params.cancelUrl)) {
    throw new ArcoraError("INVALID_URL", `cancelUrl must be http(s): got ${params.cancelUrl}`);
  }

  const o = getOpts();
  let res: Response;
  try {
    res = await fetch(`${baseUrl()}/api/invoices`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Arcora-Api-Key": o.apiKey,
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

function openCheckout(invoice: { url: string }): void {
  if (typeof window === "undefined") {
    throw new ArcoraError("UNKNOWN", "openCheckout requires a browser environment");
  }
  window.location.href = invoice.url;
}

export const Arcora = { init, createInvoice, openCheckout };
