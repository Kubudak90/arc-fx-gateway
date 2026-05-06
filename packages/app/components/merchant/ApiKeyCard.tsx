"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useMemo, useState } from "react";
import { Copy, RefreshCw } from "lucide-react";
import { toast } from "sonner";

/** Parses textarea content (one origin per line) into validated URL strings.
 *  Allows http only when host is localhost / 127.0.0.1 (dev convenience). */
function parseOriginLines(raw: string): { ok: string[]; bad: string[] } {
  const ok: string[] = [];
  const bad: string[] = [];
  for (const line of raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
    try {
      const u = new URL(line);
      const isLocalhost = u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "::1";
      if (u.protocol === "https:" || (u.protocol === "http:" && isLocalhost)) {
        ok.push(line);
      } else {
        bad.push(line);
      }
    } catch {
      bad.push(line);
    }
  }
  return { ok, bad };
}

export function ApiKeyCard({ hasMerchant, onBootstrap }: { hasMerchant: boolean; onBootstrap: () => Promise<void> }) {
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [originsRaw, setOriginsRaw] = useState("");

  const parsed = useMemo(() => parseOriginLines(originsRaw), [originsRaw]);
  const canBootstrap = hasMerchant || parsed.ok.length >= 1;

  async function generate() {
    setBusy(true);
    try {
      const endpoint = hasMerchant ? "/api/merchant/api-key" : "/api/merchant/bootstrap";
      const body = hasMerchant ? undefined : JSON.stringify({
        payoutToken: process.env.NEXT_PUBLIC_USDC_ADDRESS,
        allowedOrigins: parsed.ok,
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
            <code className="block p-3 bg-arcora-gray rounded font-mono text-xs break-all">{revealedKey}</code>
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
            {!hasMerchant && (
              <div className="space-y-2">
                <label htmlFor="allowed-origins" className="text-sm font-medium">Allowed origins (one per line)</label>
                <textarea
                  id="allowed-origins"
                  value={originsRaw}
                  onChange={(e) => setOriginsRaw(e.target.value)}
                  placeholder={"https://your-shop.com\nhttps://staging.your-shop.com"}
                  rows={3}
                  className="w-full rounded border border-input bg-background px-3 py-2 text-sm font-mono"
                />
                <p className="text-xs text-muted-foreground">
                  URLs in this list can receive your customers after payment success. We accept https everywhere; http is allowed only for localhost during development.
                </p>
                {parsed.bad.length > 0 && (
                  <p className="text-xs text-red-600">
                    Skipped {parsed.bad.length} invalid line{parsed.bad.length === 1 ? "" : "s"} (use a full https URL).
                  </p>
                )}
              </div>
            )}
            <Button onClick={generate} disabled={busy || !canBootstrap}>
              {hasMerchant ? <><RefreshCw className="size-4 mr-2" />Rotate key</> : "Generate API key"}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
