"use client";

import { useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { toast } from "sonner";

export function CreateInvoiceDialog({ apiKey, onCreated }: { apiKey: string | null; onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("49.99");
  const [payIn, setPayIn] = useState<"USDC" | "EURC">("EURC");
  const [successUrl, setSuccessUrl] = useState("https://example.com/success");
  const [busy, setBusy] = useState(false);

  async function handleSubmit() {
    if (!apiKey) { toast.error("Generate an API key in Settings first"); return; }
    setBusy(true);
    try {
      const res = await fetch("/api/invoices", {
        method: "POST",
        headers: { "content-type": "application/json", "X-Arcora-Api-Key": apiKey },
        body: JSON.stringify({ amountUsdc: Number(amount), payInToken: payIn, successUrl }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "create failed");
      }
      toast.success("Invoice created");
      setOpen(false);
      onCreated();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button className="btn-cb-pill-light inline-flex items-center gap-2" onClick={() => setOpen(true)}>
        <Plus className="size-4" /> New invoice
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New invoice</DialogTitle>
        </DialogHeader>
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
      </DialogContent>
    </Dialog>
    </>
  );
}
