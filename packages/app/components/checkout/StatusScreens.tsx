"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";

export function SuccessScreen({ successUrl }: { successUrl: string }) {
  const [seconds, setSeconds] = useState(3);
  useEffect(() => {
    const t = setInterval(() => setSeconds((s) => s - 1), 1000);
    const r = setTimeout(() => { window.location.href = successUrl; }, 3000);
    return () => { clearInterval(t); clearTimeout(r); };
  }, [successUrl]);
  return (
    <div className="text-center space-y-4 py-12">
      <div className="mx-auto size-16 rounded-full bg-emerald-50 grid place-items-center">
        <Check className="size-8 text-emerald-600" />
      </div>
      <h2 className="font-[family-name:var(--font-display)] text-3xl">Payment received</h2>
      <p className="text-sm text-muted-foreground">Redirecting to merchant in {seconds}s…</p>
    </div>
  );
}

export function ExpiredScreen({ cancelUrl }: { cancelUrl?: string }) {
  return (
    <div className="text-center space-y-4 py-12">
      <h2 className="font-[family-name:var(--font-display)] text-3xl">Invoice expired</h2>
      <p className="text-sm text-muted-foreground">Please request a new invoice from the merchant.</p>
      {cancelUrl && (
        <a href={cancelUrl} className="btn-arcora-pill-light inline-block">Return to merchant</a>
      )}
    </div>
  );
}

export function NotFoundScreen() {
  return (
    <div className="text-center space-y-4 py-12">
      <h2 className="font-[family-name:var(--font-display)] text-3xl">Invoice not found</h2>
      <p className="text-sm text-muted-foreground">This invoice doesn&apos;t exist or has been removed.</p>
    </div>
  );
}
