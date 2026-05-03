"use client";

import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { QrCode } from "lucide-react";
import { formatCurrency, formatRelativeTime, symbolForAddress } from "@/lib/ui/format";
import { InvoiceShareQRDialog } from "./InvoiceShareQRDialog";
import { RefundButton } from "./RefundButton";
import { useState } from "react";

export type InvoiceStatus = "created" | "paid" | "expired" | "refunded";

export interface InvoiceRow {
  id: string;
  payInToken: string;
  amountOut: string;
  status: InvoiceStatus;
  paidTx: string | null;
  gatewayAddress: string | null;
  createdAt: string;
}

interface InvoiceTableProps {
  invoices: InvoiceRow[];
  payoutToken: string;
  onChange?: () => void;
}

export function InvoiceTable({ invoices, payoutToken, onChange }: InvoiceTableProps) {
  const [qrInvoiceId, setQrInvoiceId] = useState<string | null>(null);

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>ID</TableHead>
            <TableHead>Amount</TableHead>
            <TableHead>Pay-in</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Created</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {invoices.map(inv => (
            <TableRow key={inv.id}>
              <TableCell className="font-mono text-xs">{inv.id.slice(0, 10)}…</TableCell>
              <TableCell>{formatCurrency(inv.amountOut, payoutToken)}</TableCell>
              <TableCell>{symbolForAddress(inv.payInToken)}</TableCell>
              <TableCell>
                <StatusBadge status={inv.status} />
              </TableCell>
              <TableCell className="text-muted-foreground">{formatRelativeTime(inv.createdAt)}</TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-1">
                  {inv.status === "paid" && (
                    <RefundButton
                      invoiceId={inv.id}
                      payoutToken={payoutToken}
                      gatewayAddress={inv.gatewayAddress}
                      onRefunded={onChange}
                    />
                  )}
                  <Button size="sm" variant="ghost" onClick={() => setQrInvoiceId(inv.id)}>
                    <QrCode className="size-4" />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
          {invoices.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="text-center text-muted-foreground py-12">
                No invoices yet — create one to get started.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      {qrInvoiceId && (
        <InvoiceShareQRDialog
          invoiceId={qrInvoiceId}
          onClose={() => setQrInvoiceId(null)}
        />
      )}
    </>
  );
}

function StatusBadge({ status }: { status: InvoiceStatus }) {
  const variants: Record<InvoiceStatus, string> = {
    paid:     "bg-emerald-50 text-emerald-700 border-emerald-200",
    created:  "bg-amber-50 text-amber-700 border-amber-200",
    expired:  "bg-neutral-100 text-neutral-600 border-neutral-200",
    refunded: "bg-sky-50 text-sky-700 border-sky-200",
  };
  const labels: Record<InvoiceStatus, string> = {
    paid: "Paid", created: "Pending", expired: "Expired", refunded: "Refunded",
  };
  const dotColor: Record<InvoiceStatus, string> = {
    paid: "bg-emerald-500", created: "bg-amber-500", expired: "bg-neutral-400", refunded: "bg-sky-500",
  };
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold border ${variants[status]}`}>
      <span className={`size-1.5 rounded-full ${dotColor[status]}`} />
      {labels[status]}
    </span>
  );
}
