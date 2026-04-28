"use client";

import { QRCodeSVG } from "qrcode.react";
import { Copy, ArrowLeft } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

interface MobileWalletQRProps {
  url: string;
  onBack: () => void;
}

export function MobileWalletQR({ url, onBack }: MobileWalletQRProps) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    toast.success("Link copied");
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="space-y-6 text-center py-4">
      <h2 className="font-[family-name:var(--font-display)] text-2xl">Scan with mobile wallet</h2>

      <div className="mx-auto inline-block p-6 bg-white rounded-2xl border border-arcora-border">
        <QRCodeSVG value={url} size={224} level="M" includeMargin={false} />
      </div>

      <p className="text-sm text-muted-foreground max-w-xs mx-auto">
        Open this link on your phone to complete the payment with your mobile wallet.
      </p>

      <div className="space-y-2">
        <button onClick={copy} className="btn-arcora-pill-light inline-flex items-center gap-2">
          <Copy className="size-4" /> {copied ? "Copied!" : "Copy link"}
        </button>
      </div>

      <button onClick={onBack} className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:underline">
        <ArrowLeft className="size-4" /> Back to desktop checkout
      </button>
    </div>
  );
}
