// packages/agent-commerce-core/src/commerce.ts
import { Arcora } from "@arcora/sdk";
import type { CreateInvoiceParams, Invoice } from "@arcora/sdk";
import { CATALOG, findItem, type CatalogItem } from "./catalog";
import type { CommerceConfig } from "./config";

/** Minimal surface of the Arcora SDK used here — lets tests inject a fake. */
export interface InvoiceCreator {
  createInvoice(params: CreateInvoiceParams): Promise<Invoice>;
}

export type CheckoutStatus = "created" | "paid" | "expired" | "refunded" | "failed" | "unknown";

export interface CreateInvoiceResult {
  invoiceId: string;
  url: string;
  item: CatalogItem;
}

export class Commerce {
  private readonly arcora: InvoiceCreator;

  constructor(
    private readonly config: CommerceConfig,
    arcora?: InvoiceCreator,
  ) {
    this.arcora = arcora ?? new Arcora({ apiKey: config.apiKey, baseUrl: config.baseUrl });
  }

  listCatalog(): CatalogItem[] {
    return [...CATALOG];
  }

  async createInvoiceForItem(itemId: string): Promise<CreateInvoiceResult> {
    const item = findItem(itemId);
    if (!item) throw new Error(`unknown_item:${itemId}`);
    const invoice = await this.arcora.createInvoice({
      amountUsdc: item.priceUsdc,
      payInToken: "USDC",
      successUrl: this.config.successUrl,
      metadata: { itemId: item.id, itemName: item.name },
    });
    return { invoiceId: invoice.invoiceId, url: invoice.url, item };
  }

  async getCheckoutStatus(invoiceId: string): Promise<CheckoutStatus> {
    let res: Response;
    try {
      res = await fetch(`${this.config.baseUrl}/api/invoices/${invoiceId}`);
    } catch (cause) {
      throw new Error("status_lookup_failed:network", { cause });
    }
    if (res.status === 404) return "unknown";
    if (!res.ok) throw new Error(`status_lookup_failed:${res.status}`);
    let json: { status?: string };
    try {
      json = (await res.json()) as { status?: string };
    } catch (cause) {
      throw new Error("status_lookup_failed:network", { cause });
    }
    // Maps the live invoice_status pgEnum (packages/app/lib/db/schema.ts):
    // created | paid | expired | refunded | failed | claimed | recovered.
    switch (json.status) {
      case "created":
        return "created";
      case "paid":
      case "claimed": // merchant pulled the escrow — payment succeeded
        return "paid";
      case "expired":
        return "expired";
      case "refunded":
        return "refunded";
      case "failed":
        return "failed";
      default: // "recovered" + any unrecognized/missing status
        return "unknown";
    }
  }
}
