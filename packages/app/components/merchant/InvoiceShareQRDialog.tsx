"use client";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { QRCodeSVG } from "qrcode.react";
import { Copy, Printer } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export function InvoiceShareQRDialog({ invoiceId, onClose }: { invoiceId: string; onClose: () => void }) {
  const url = typeof window !== "undefined"
    ? `${process.env.NEXT_PUBLIC_BASE_URL ?? window.location.origin}/i/${invoiceId}`
    : "";
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    toast.success("Link copied");
    setTimeout(() => setCopied(false), 2000);
  }

  function handlePrint() { window.print(); }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Share invoice</DialogTitle></DialogHeader>
        <div className="space-y-4 text-center">
          <div className="mx-auto inline-block p-6 bg-white rounded-2xl border border-arcora-border print:border-0">
            <QRCodeSVG value={url} size={224} level="M" />
          </div>
          <code className="block text-xs text-muted-foreground break-all px-2">{url}</code>
          <div className="flex gap-2 justify-center print:hidden">
            <button
              type="button"
              onClick={copy}
              className="inline-flex items-center gap-2 rounded-full bg-arcora-slate text-white px-4 py-2 text-sm font-semibold shadow-sm hover:bg-arcora-blue transition-colors"
            >
              <Copy className="size-4" /> {copied ? "Copied!" : "Copy URL"}
            </button>
            <button
              type="button"
              onClick={handlePrint}
              className="inline-flex items-center gap-2 rounded-full border border-arcora-border bg-white text-arcora-slate px-4 py-2 text-sm font-semibold shadow-sm hover:bg-arcora-gray/60 transition-colors"
            >
              <Printer className="size-4" /> Print
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
