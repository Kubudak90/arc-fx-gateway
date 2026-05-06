"use client";

import { useEffect, useMemo, useState } from "react";
import { Check } from "lucide-react";
import { safeClientRedirect } from "@/lib/security/redirect";

/** Returns true when `url` is safe to render as a clickable link from this
 *  page — same rules as `safeClientRedirect` minus the `window.location` write. */
function isOriginAllowed(url: string | undefined, allowedOrigins: readonly string[]): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    return allowedOrigins.includes(u.origin);
  } catch {
    return false;
  }
}

export function SuccessScreen({ successUrl, allowedOrigins }: { successUrl: string; allowedOrigins: readonly string[] }) {
  const safe = useMemo(() => isOriginAllowed(successUrl, allowedOrigins), [successUrl, allowedOrigins]);
  const [seconds, setSeconds] = useState(3);

  useEffect(() => {
    if (!safe) return;
    const t = setInterval(() => setSeconds((s) => s - 1), 1000);
    const r = setTimeout(() => { safeClientRedirect(successUrl, allowedOrigins); }, 3000);
    return () => { clearInterval(t); clearTimeout(r); };
  }, [safe, successUrl, allowedOrigins]);

  if (!safe) {
    // Audit H1 (2026-05-05): server should never persist an out-of-allowlist
    // URL, but if a stale invoice or DOM tamper produces one we render a
    // static "payment received" screen rather than auto-redirecting to an
    // attacker-controlled page.
    return (
      <div className="text-center space-y-4 py-12">
        <div className="mx-auto size-16 rounded-full bg-emerald-50 grid place-items-center">
          <Check className="size-8 text-emerald-600" />
        </div>
        <h2 className="font-[family-name:var(--font-display)] text-3xl">Payment received</h2>
        <p className="text-sm text-muted-foreground">
          We can&apos;t safely return you to the merchant — the redirect target isn&apos;t in their allowlist. Close this tab or contact the merchant directly.
        </p>
      </div>
    );
  }

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

export function ExpiredScreen({ cancelUrl, allowedOrigins }: { cancelUrl?: string; allowedOrigins: readonly string[] }) {
  const safe = isOriginAllowed(cancelUrl, allowedOrigins);
  return (
    <div className="text-center space-y-4 py-12">
      <h2 className="font-[family-name:var(--font-display)] text-3xl">Invoice expired</h2>
      <p className="text-sm text-muted-foreground">Please request a new invoice from the merchant.</p>
      {safe && cancelUrl && (
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
