// packages/agent-commerce-mcp/src/tools.ts
import type { Commerce, Refunder } from "@arcora/agent-commerce-core";

export interface ToolResult {
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

/** Only the bits the tools use — lets tests inject a fake. */
export type CommerceLike = Pick<Commerce, "listCatalog" | "createInvoiceForItem" | "getCheckoutStatus">;

/** Only the bit refund_invoice uses — lets tests inject a fake. */
export type RefunderLike = Pick<Refunder, "refund">;

export async function listCatalogTool(commerce: CommerceLike): Promise<ToolResult> {
  const lines = commerce
    .listCatalog()
    .map((i) => `${i.emoji} ${i.id} — ${i.name} — ${i.priceUsdc} USDC — ${i.description}`);
  return { content: [{ type: "text", text: lines.join("\n") }] };
}

export async function createInvoiceTool(
  commerce: CommerceLike,
  args: { itemId: string },
): Promise<ToolResult> {
  try {
    const r = await commerce.createInvoiceForItem(args.itemId);
    return {
      content: [
        {
          type: "text",
          text: `Invoice for ${r.item.name} (${r.item.priceUsdc} USDC) created.\nInvoice ID: ${r.invoiceId}\nPay here: ${r.url}`,
        },
      ],
    };
  } catch (e) {
    return { content: [{ type: "text", text: `Failed to create invoice: ${(e as Error).message}` }], isError: true };
  }
}

export async function checkoutStatusTool(
  commerce: CommerceLike,
  args: { invoiceId: string },
): Promise<ToolResult> {
  try {
    const status = await commerce.getCheckoutStatus(args.invoiceId);
    return { content: [{ type: "text", text: `Checkout status for ${args.invoiceId}: ${status}` }] };
  } catch (e) {
    return { content: [{ type: "text", text: `Failed to read status: ${(e as Error).message}` }], isError: true };
  }
}

export async function refundInvoiceTool(
  refunder: RefunderLike,
  args: { invoiceId: string },
): Promise<ToolResult> {
  try {
    const r = await refunder.refund(args.invoiceId);
    return {
      content: [
        {
          type: "text",
          text: `Refunded invoice ${r.invoiceId} to the original payer.\nRefund tx: ${r.txHash}\nStatus: ${r.status}`,
        },
      ],
    };
  } catch (e) {
    return { content: [{ type: "text", text: `Failed to refund: ${(e as Error).message}` }], isError: true };
  }
}
