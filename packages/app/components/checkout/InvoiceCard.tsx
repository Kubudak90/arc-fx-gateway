import { formatCurrency, symbolForAddress, abbreviateAddress } from "@/lib/ui/format";
import { ExpiryCountdown } from "./ExpiryCountdown";

interface LineItem {
  name?: string;
  description?: string;
  quantity?: number;
  amount?: number | string;
  sku?: string;
  [key: string]: unknown;
}

interface InvoiceCardProps {
  amountOut: string;
  payoutTokenAddress: string;
  payInTokenAddress: string;
  status: "created" | "paid" | "expired" | "failed";
  invoiceId?: string;
  expiresAt?: Date;
  merchantAddress?: string;
  metadata?: unknown;
}

export function InvoiceCard({
  amountOut,
  payoutTokenAddress,
  payInTokenAddress,
  status,
  invoiceId,
  expiresAt,
  merchantAddress,
  metadata,
}: InvoiceCardProps) {
  const amount = formatCurrency(amountOut, payoutTokenAddress);
  const payInSymbol = symbolForAddress(payInTokenAddress);

  // Parse line items from metadata only if they exist
  const lineItems: LineItem[] | null = (() => {
    if (!metadata || typeof metadata !== "object") return null;
    const m = metadata as Record<string, unknown>;
    if (!Array.isArray(m.lineItems) || m.lineItems.length === 0) return null;
    return m.lineItems as LineItem[];
  })();

  return (
    <div className="flex flex-col gap-6 flex-1">
      {/* Amount block */}
      <div className="flex flex-col gap-1">
        <p className="eyebrow">Invoice total</p>
        <div className="font-[family-name:var(--font-display)] font-light text-[56px] leading-[1] tracking-[-0.025em] text-arcora-slate mt-2">
          {amount}
        </div>
        <p className="text-[13px] text-arcora-muted-fg mt-1">
          You&apos;ll pay in <span className="font-semibold text-arcora-slate">{payInSymbol}</span>
        </p>
        {status === "paid" && <StatusBadge variant="paid" />}
        {status === "expired" && <StatusBadge variant="expired" />}
        {status === "failed" && <StatusBadge variant="failed" />}
      </div>

      {/* Invoice metadata row */}
      {(invoiceId || expiresAt) && (
        <div className="flex flex-wrap gap-4 font-[family-name:var(--font-mono)] text-[11px] text-arcora-muted-fg tracking-[0.04em]">
          {invoiceId && (
            <span>
              <span className="uppercase tracking-[0.1em] mr-1 opacity-60">ID</span>
              <span className="text-arcora-slate">{invoiceId.slice(0, 8)}…</span>
            </span>
          )}
          {expiresAt && (
            <ExpiryCountdown
              expiresAt={expiresAt}
              className={status === "expired" ? "text-red-500" : ""}
            />
          )}
        </div>
      )}

      {/* Hairline */}
      <div className="hairline" />

      {/* Line items — only rendered when metadata actually carries them */}
      {lineItems && (
        <div className="flex flex-col gap-0">
          {lineItems.map((item, i) => (
            <div key={i} className="flex items-center justify-between py-3 border-b border-arcora-border">
              <div className="flex flex-col gap-0.5">
                <span className="text-[14px] font-medium text-arcora-slate">
                  {item.name ?? "Item"}
                </span>
                {item.description && (
                  <span className="font-[family-name:var(--font-mono)] text-[11px] text-arcora-muted-fg">
                    {item.description}
                  </span>
                )}
                {item.sku && (
                  <span className="font-[family-name:var(--font-mono)] text-[11px] text-arcora-muted-fg">
                    SKU {item.sku}{item.quantity != null ? ` · qty ${item.quantity}` : ""}
                  </span>
                )}
              </div>
              {item.amount != null && (
                <span className="font-[family-name:var(--font-mono)] text-[13px] font-medium text-arcora-slate">
                  {item.amount}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Merchant address footer */}
      {merchantAddress && (
        <div className="mt-auto pt-4 border-t border-arcora-border">
          <div className="flex justify-between items-center font-[family-name:var(--font-mono)] text-[11px] text-arcora-muted-fg tracking-[0.04em]">
            <span className="uppercase tracking-[0.1em]">Merchant</span>
            <span className="text-arcora-slate">{abbreviateAddress(merchantAddress)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ variant }: { variant: "paid" | "expired" | "failed" }) {
  const styles =
    variant === "paid"
      ? "text-emerald-700 border-emerald-200 bg-emerald-50"
      : variant === "failed"
      ? "text-red-700 border-red-200 bg-red-50"
      : "text-arcora-muted-fg border-arcora-border bg-arcora-gray";
  return (
    <div className={`mt-2 inline-flex items-center px-2 py-[3px] border font-[family-name:var(--font-mono)] text-[10px] font-semibold tracking-[0.12em] uppercase ${styles}`}>
      {variant}
    </div>
  );
}
