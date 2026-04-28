"use client";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
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
            <Button onClick={copy} variant="outline" size="sm">
              <Copy className="size-4 mr-2" /> {copied ? "Copied!" : "Copy URL"}
            </Button>
            <Button onClick={handlePrint} variant="outline" size="sm">
              <Printer className="size-4 mr-2" /> Print
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
