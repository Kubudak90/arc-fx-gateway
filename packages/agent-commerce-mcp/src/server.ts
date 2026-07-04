// packages/agent-commerce-mcp/src/server.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { Commerce, Refunder } from "@arcora/agent-commerce-core";
import { listCatalogTool, createInvoiceTool, checkoutStatusTool, refundInvoiceTool } from "./tools.js";

/** Options for buildServer. `refunder` is optional — when omitted, the
 *  refund_invoice tool is NOT registered (the serve command only wires a
 *  refunder when a merchant key is available). */
export interface BuildServerOptions {
  refunder?: Refunder;
}

export function buildServer(commerce: Commerce, opts: BuildServerOptions = {}): McpServer {
  const server = new McpServer(
    { name: "arcora-agent-commerce", version: "0.1.3" },
    {
      instructions: [
        "You are an Arcorapay MERCHANT. These tools let you sell items from your catalog and get paid in USDC — payable cross-chain (the buyer can pay on Arc, or bridge from another chain such as Base). Treat this like a checkout you give to a buyer, not like your own wallet: you never spend your own funds to make a sale.",
        "",
        "How to sell (follow in order):",
        "1. When someone wants to buy, call `list_catalog` to see what's for sale (id, name, price in USDC).",
        "2. Call `create_invoice` with the chosen item's `id`. It returns an invoice id and a checkout URL.",
        "3. Give the buyer the checkout URL so they can pay. Do NOT collect card or wallet details yourself — the hosted checkout handles payment.",
        "4. Poll `get_checkout_status` with the invoice id. Deliver the item ONLY once it returns `paid`. Statuses: created = still unpaid; paid = deliver now; expired / failed = do not deliver; refunded = money was returned to the buyer; unknown = check again later.",
        "",
        "Refunds: call `refund_invoice` with a paid invoice's id to send the USDC back to the ORIGINAL payer (within the 7-day refund window). Funds can only go back to the buyer who paid — you cannot redirect them. (Available only when the server is started with a merchant signing key.)",
        "",
        "Rules of thumb: prices are in USDC; the BUYER pays, not you; one invoice per purchase; never fulfill before status is `paid`.",
      ].join("\n"),
    },
  );

  server.registerTool(
    "list_catalog",
    {
      title: "List catalog",
      description: "Step 1 of a sale: list the products this merchant sells (id, name, price). Call this when a buyer wants to purchase.",
      inputSchema: {},
    },
    async (): Promise<CallToolResult> => ({ ...(await listCatalogTool(commerce)) }),
  );

  server.registerTool(
    "create_invoice",
    {
      title: "Create invoice",
      description:
        "Create an Arcorapay invoice for a catalog item id. Returns an invoice id and a checkout URL the buyer pays (cross-chain from Base supported).",
      inputSchema: { itemId: z.string().describe("Catalog item id, e.g. logo-pack") },
    },
    async ({ itemId }): Promise<CallToolResult> => ({ ...(await createInvoiceTool(commerce, { itemId })) }),
  );

  server.registerTool(
    "get_checkout_status",
    {
      title: "Get checkout status",
      description: "Poll an invoice's payment status after create_invoice; deliver the item only when it returns `paid`. Values: created | paid | expired | failed | refunded | unknown.",
      inputSchema: { invoiceId: z.string().describe("Invoice id returned by create_invoice") },
    },
    async ({ invoiceId }): Promise<CallToolResult> => ({ ...(await checkoutStatusTool(commerce, { invoiceId })) }),
  );

  if (opts.refunder) {
    const refunder = opts.refunder;
    server.registerTool(
      "refund_invoice",
      {
        title: "Refund invoice",
        description:
          "Refund a PAID invoice — returns the escrowed USDC to the ORIGINAL payer on Arc. Only valid while the invoice is paid and within the 7-day refund window; funds cannot be redirected to anyone else. Input: invoiceId (the id returned by create_invoice).",
        inputSchema: { invoiceId: z.string().describe("Invoice id returned by create_invoice") },
      },
      async ({ invoiceId }): Promise<CallToolResult> => ({ ...(await refundInvoiceTool(refunder, { invoiceId })) }),
    );
  }

  return server;
}
