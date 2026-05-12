"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { toast } from "sonner";

export function WebhookSettingsCard({ initialUrl }: { initialUrl: string | null }) {
  const [url, setUrl] = useState(initialUrl ?? "");
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Audit #32: server already rejects non-https + SSRF, but a client-side
  // scheme check turns the silent 400 into an inline error before the
  // PATCH fires. Empty string is allowed (= clear the webhook).
  function urlError(): string | null {
    const trimmed = url.trim();
    if (trimmed === "") return null;
    try {
      const u = new URL(trimmed);
      if (u.protocol !== "https:") return "URL must start with https://";
      return null;
    } catch {
      return "Not a valid URL";
    }
  }
  const urlErr = urlError();

  async function save() {
    if (urlErr) { toast.error(urlErr); return; }
    setBusy(true);
    try {
      const res = await fetch("/api/merchant/webhook", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ webhookUrl: url.trim() || null }),
      });
      if (!res.ok) throw new Error("save failed");
      toast.success("Webhook URL saved");
    } catch (e: any) { toast.error(e.message); }
    finally { setBusy(false); }
  }

  async function rotateSecret() {
    setBusy(true);
    try {
      const res = await fetch("/api/merchant/webhook", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "rotate failed");
      setRevealedSecret(data.webhookSecret);
    } catch (e: any) { toast.error(e.message); }
    finally { setBusy(false); }
  }

  return (
    <Card>
      <CardHeader><CardTitle>Webhooks</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div>
          <label className="text-sm font-medium">URL</label>
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://your-app.com/webhooks/arcora"
            aria-invalid={urlErr ? true : undefined}
          />
          {urlErr && <p className="mt-1 text-xs text-red-600">{urlErr}</p>}
        </div>
        <div className="flex gap-2">
          <Button onClick={save} disabled={busy || !!urlErr}>Save</Button>
          <Button onClick={rotateSecret} variant="outline" disabled={busy}>Rotate signing secret</Button>
        </div>
        {revealedSecret && (
          <div className="space-y-2">
            <code className="block p-3 bg-arcora-gray rounded font-mono text-xs break-all">{revealedSecret}</code>
            <p className="text-xs text-muted-foreground">
              Verify webhooks: <code>X-Arcora-Signature</code> = sha256=hex(HMAC-SHA256(body, secret)).
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
