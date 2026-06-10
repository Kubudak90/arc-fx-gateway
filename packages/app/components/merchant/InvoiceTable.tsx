"use client";

import { QrCode } from "lucide-react";
import { formatCurrency, formatRelativeTime, symbolForAddress } from "@/lib/ui/format";
import { InvoiceShareQRDialog } from "./InvoiceShareQRDialog";
import { RefundButton } from "./RefundButton";
import { useState } from "react";

export type InvoiceStatus = "created" | "paid" | "expired" | "refunded" | "claimed" | "recovered" | "failed";

export interface InvoiceRow {
  id: string;
  payInToken: string;
  amountOut: string;
  status: InvoiceStatus;
  paidTx: string | null;
  gatewayAddress: string | null;
  /** ISO timestamp of when the refund window closes (= claimableAt). */
  claimableAt?: string | null;
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
      <table className="tbl">
        <thead>
          <tr>
            <th>ID</th>
            <th>Amount</th>
            <th>Pay-in</th>
            <th>Status</th>
            <th>Created</th>
            <th className="text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {invoices.map(inv => (
            <tr key={inv.id}>
              <td className="mono text-[var(--fg-2)]">{inv.id.slice(0, 10)}…</td>
              <td className="mono font-medium">{formatCurrency(inv.amountOut, payoutToken)}</td>
              <td>
                <span className="inline-flex items-center gap-[7px]">
                  <Coin sym={symbolForAddress(inv.payInToken)} />
                  <span className="mono text-[12px]">{symbolForAddress(inv.payInToken)}</span>
                </span>
              </td>
              <td>
                <StatusBadge status={inv.status} />
              </td>
              <td className="mono text-[12px] text-[var(--fg-3)]">{formatRelativeTime(inv.createdAt)}</td>
              <td>
                <div className="flex justify-end items-center gap-1.5">
                  <RefundButton
                    invoiceId={inv.id}
                    payoutToken={payoutToken}
                    gatewayAddress={inv.gatewayAddress}
                    claimableAt={inv.claimableAt}
                    status={inv.status}
                    onRefunded={onChange}
                  />
                  <button
                    type="button"
                    className="iconbtn"
                    style={{ width: 30, height: 30 }}
                    title="Share QR"
                    aria-label="Share QR"
                    onClick={() => setQrInvoiceId(inv.id)}
                  >
                    <QrCode className="size-3.5" />
                  </button>
                </div>
              </td>
            </tr>
          ))}
          {invoices.length === 0 && (
            <tr>
              <td colSpan={6} className="mono text-center text-[var(--fg-3)] py-12">
                No invoices yet — create one to get started.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {qrInvoiceId && (
        <InvoiceShareQRDialog
          invoiceId={qrInvoiceId}
          onClose={() => setQrInvoiceId(null)}
        />
      )}
    </>
  );
}

function Coin({ sym }: { sym: string }) {
  const cls: Record<string, string> = {
    USDC: "coin--usdc", EURC: "coin--eurc", USDT: "coin--usdt", DAI: "coin--dai", PYUSD: "coin--pyusd",
  };
  const label: Record<string, string> = { USDC: "$", EURC: "€", USDT: "₮", DAI: "◈", PYUSD: "P" };
  return (
    <span className={`coin ${cls[sym] ?? "coin--usdc"}`} aria-hidden="true">
      {label[sym] ?? sym.slice(0, 1)}
    </span>
  );
}

/** Status → [label, color] per the UI v2 STATUS map (m-shell.jsx). */
const STATUS: Record<InvoiceStatus, [string, string, string]> = {
  paid:      ["Paid",      "var(--success)", "var(--success-bg)"],
  created:   ["Pending",   "var(--warning)", "var(--warning-bg)"],
  expired:   ["Expired",   "var(--fg-3)",    "transparent"],
  refunded:  ["Refunded",  "var(--info)",    "var(--info-bg)"],
  failed:    ["Failed",    "var(--danger)",  "var(--danger-bg)"],
  claimed:   ["Claimed",   "#b794f6",        "color-mix(in oklch, #b794f6 16%, transparent)"],
  recovered: ["Recovered", "#f0a868",        "color-mix(in oklch, #f0a868 16%, transparent)"],
};

function StatusBadge({ status }: { status: InvoiceStatus }) {
  const [label, color, bg] = STATUS[status] ?? STATUS.paid;
  return (
    <span
      className="inline-flex items-center gap-1.5 px-[9px] py-[3px] rounded-full text-[11px] font-semibold whitespace-nowrap"
      style={{
        color,
        background: bg,
        border: `1px solid color-mix(in oklch, ${color} 30%, transparent)`,
      }}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}
