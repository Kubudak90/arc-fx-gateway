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

  async function save() {
    setBusy(true);
    try {
      const res = await fetch("/api/merchant/webhook", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ webhookUrl: url || null }),
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
          <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://your-app.com/webhooks/arcora" />
        </div>
        <div className="flex gap-2">
          <Button onClick={save} disabled={busy}>Save</Button>
          <Button onClick={rotateSecret} variant="outline" disabled={busy}>Rotate signing secret</Button>
        </div>
        {revealedSecret && (
          <div className="space-y-2">
            <code className="block p-3 bg-cb-cool-gray rounded font-mono text-xs break-all">{revealedSecret}</code>
            <p className="text-xs text-muted-foreground">
              Verify webhooks: <code>X-Arcora-Signature</code> = sha256=hex(HMAC-SHA256(body, secret)).
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
