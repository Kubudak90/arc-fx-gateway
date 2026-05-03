"use client";

import { useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Plus, Copy, Share2, ExternalLink, Check } from "lucide-react";
import { toast } from "sonner";

interface Created { invoiceId: string; url: string; }

export function CreateInvoiceDialog({ apiKey, onCreated }: { apiKey: string | null; onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("49.99");
  const [payIn, setPayIn] = useState<"USDC" | "EURC">("EURC");
  const [successUrl, setSuccessUrl] = useState("https://example.com/success");
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<Created | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleSubmit() {
    if (!apiKey) { toast.error("Generate an API key in Settings first"); return; }
    setBusy(true);
    try {
      // Plan 9 (2026-05-03): default engine is now v9 (refund-source binding
      // fix on the gateway contract). V8 + V6 remain available via explicit
      // ?engine= query for testing.
      const res = await fetch("/api/invoices?engine=v9", {
        method: "POST",
        headers: { "content-type": "application/json", "X-Arcora-Api-Key": apiKey },
        body: JSON.stringify({ amountUsdc: Number(amount), payInToken: payIn, successUrl }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "create failed");
      }
      const data = await res.json() as Created;
      setCreated(data);
      onCreated();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    if (!created) return;
    await navigator.clipboard.writeText(created.url);
    setCopied(true);
    toast.success("Link copied");
    setTimeout(() => setCopied(false), 1800);
  }

  async function shareLink() {
    if (!created) return;
    if (typeof navigator !== "undefined" && "share" in navigator) {
      try {
        await navigator.share({
          title: "Pay invoice",
          text: `Pay $${amount} on Arcora`,
          url: created.url,
        });
      } catch { /* user cancelled — no-op */ }
    } else {
      await copyLink();
    }
  }

  function reset() {
    setCreated(null);
    setCopied(false);
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) reset();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-full bg-arcora-slate text-white px-4 py-2 text-sm font-semibold shadow-sm hover:bg-arcora-blue transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-arcora-blue"
      >
        <Plus className="size-4" /> Create invoice
      </button>
      <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{created ? "Invoice created" : "Create invoice"}</DialogTitle>
        </DialogHeader>
        {created ? (
          <div className="space-y-4 pt-2">
            <p className="text-sm text-muted-foreground">
              Send this link to your customer — anyone with the URL can pay.
            </p>
            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Checkout link</Label>
              <code className="block p-3 bg-arcora-gray rounded font-mono text-xs break-all">
                {created.url}
              </code>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button onClick={copyLink} variant="outline" className="w-full">
                {copied ? <><Check className="size-4 mr-2" />Copied</> : <><Copy className="size-4 mr-2" />Copy link</>}
              </Button>
              <Button onClick={shareLink} variant="outline" className="w-full">
                <Share2 className="size-4 mr-2" />Share
              </Button>
            </div>
            <a
              href={created.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-arcora-link hover:underline"
            >
              <ExternalLink className="size-3.5" /> Open checkout in new tab
            </a>
            <div className="flex gap-2 pt-2">
              <Button onClick={reset} variant="ghost" className="flex-1">Create another</Button>
              <Button onClick={() => handleOpenChange(false)} className="flex-1">Done</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-5 pt-2">
            <div className="space-y-2">
              <Label htmlFor="invoice-amount">Amount (USD-equivalent)</Label>
              <Input id="invoice-amount" type="number" step="0.01" min="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="invoice-payin">Customer pays in</Label>
              <select
                id="invoice-payin"
                value={payIn}
                onChange={(e) => setPayIn(e.target.value as "USDC" | "EURC")}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="EURC">EURC</option>
                <option value="USDC">USDC</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="invoice-success">Success URL</Label>
              <Input id="invoice-success" value={successUrl} onChange={(e) => setSuccessUrl(e.target.value)} />
            </div>
            <Button disabled={busy} onClick={handleSubmit} className="w-full mt-2">
              {busy ? "Creating…" : "Create invoice"}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
    </>
  );
}
