import { Card, CardContent } from "@/components/ui/card";
import { formatCurrency, symbolForAddress } from "@/lib/ui/format";

interface InvoiceCardProps {
  amountOut: string;
  payoutTokenAddress: string;
  payInTokenAddress: string;
  status: "created" | "paid" | "expired";
}

export function InvoiceCard({ amountOut, payoutTokenAddress, payInTokenAddress, status }: InvoiceCardProps) {
  const amount = formatCurrency(amountOut, payoutTokenAddress);
  const payInSymbol = symbolForAddress(payInTokenAddress);
  return (
    <Card className="rounded-2xl border-arcora-border">
      <CardContent className="p-8">
        <div className="text-sm uppercase tracking-wider text-muted-foreground font-semibold">
          Pay merchant
        </div>
        <div className="mt-4 font-[family-name:var(--font-display)] text-[64px] leading-[1.00] tracking-tight">
          {amount}
        </div>
        <div className="mt-3 text-sm text-muted-foreground">
          You&apos;ll pay in {payInSymbol}
        </div>
        {status === "paid" && <StatusBadge variant="paid" />}
        {status === "expired" && <StatusBadge variant="expired" />}
      </CardContent>
    </Card>
  );
}

function StatusBadge({ variant }: { variant: "paid" | "expired" }) {
  const styles = variant === "paid"
    ? "bg-emerald-50 text-emerald-700"
    : "bg-neutral-100 text-neutral-600";
  return (
    <div className={`mt-4 inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold ${styles}`}>
      {variant.toUpperCase()}
    </div>
  );
}
