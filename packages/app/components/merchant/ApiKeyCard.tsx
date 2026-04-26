"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { Copy, RefreshCw } from "lucide-react";
import { toast } from "sonner";

export function ApiKeyCard({ hasMerchant, onBootstrap }: { hasMerchant: boolean; onBootstrap: () => Promise<void> }) {
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function generate() {
    setBusy(true);
    try {
      const endpoint = hasMerchant ? "/api/merchant/api-key" : "/api/merchant/bootstrap";
      const body = hasMerchant ? undefined : JSON.stringify({
        payoutToken: process.env.NEXT_PUBLIC_USDC_ADDRESS,
      });
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "failed");
      setRevealedKey(data.apiKey);
      if (!hasMerchant) await onBootstrap();
    } catch (e: any) { toast.error(e.message); }
    finally { setBusy(false); }
  }

  async function copy() {
    if (revealedKey) {
      await navigator.clipboard.writeText(revealedKey);
      toast.success("API key copied");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>API key</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {revealedKey ? (
          <>
            <code className="block p-3 bg-cb-cool-gray rounded font-mono text-xs break-all">{revealedKey}</code>
            <p className="text-sm text-muted-foreground">
              Save this now — you won&apos;t be able to see it again. Use the rotate button to generate a new one.
            </p>
            <div className="flex gap-2">
              <Button onClick={copy} size="sm" variant="outline"><Copy className="size-4 mr-2" />Copy</Button>
              <Button onClick={() => setRevealedKey(null)} size="sm" variant="ghost">Done</Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              {hasMerchant ? "Rotate your API key. The previous key will stop working immediately." : "Generate your first API key to start creating invoices programmatically."}
            </p>
            <Button onClick={generate} disabled={busy}>
              {hasMerchant ? <><RefreshCw className="size-4 mr-2" />Rotate key</> : "Generate API key"}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
