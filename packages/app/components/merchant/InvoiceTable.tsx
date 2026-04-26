"use client";

import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { QrCode } from "lucide-react";
import { formatCurrency, formatRelativeTime, symbolForAddress } from "@/lib/ui/format";
import { InvoiceShareQRDialog } from "./InvoiceShareQRDialog";
import { useState } from "react";

export interface InvoiceRow {
  id: string;
  payInToken: string;
  amountOut: string;
  status: "created" | "paid" | "expired";
  paidTx: string | null;
  createdAt: string;
}

export function InvoiceTable({ invoices, payoutToken }: { invoices: InvoiceRow[]; payoutToken: string }) {
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
            <TableHead></TableHead>
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
              <TableCell>
                <Button size="sm" variant="ghost" onClick={() => setQrInvoiceId(inv.id)}>
                  <QrCode className="size-4" />
                </Button>
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

function StatusBadge({ status }: { status: "created" | "paid" | "expired" }) {
  const variants = {
    paid: "bg-emerald-50 text-emerald-700 border-emerald-200",
    created: "bg-amber-50 text-amber-700 border-amber-200",
    expired: "bg-neutral-100 text-neutral-600 border-neutral-200",
  };
  const labels = { paid: "Paid", created: "Pending", expired: "Expired" };
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold border ${variants[status]}`}>
      <span className={`size-1.5 rounded-full ${status === "paid" ? "bg-emerald-500" : status === "created" ? "bg-amber-500" : "bg-neutral-400"}`} />
      {labels[status]}
    </span>
  );
}
