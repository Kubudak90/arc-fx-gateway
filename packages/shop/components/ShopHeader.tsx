"use client";

import Link from "next/link";
import { useCart } from "@/lib/cart";
import { ShoppingBag } from "lucide-react";

export function ShopHeader() {
  const { count } = useCart();
  return (
    <header className="sticky top-0 z-30 bg-white/80 backdrop-blur border-b border-arcora-border">
      <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <ArcoraMark className="w-6 h-6" />
          <span className="font-[family-name:var(--font-display)] text-lg font-semibold tracking-tight">
            Arcora <span className="text-arcora-muted-fg font-normal">Shop</span>
          </span>
        </Link>
        <nav className="flex items-center gap-6">
          <a
            href="https://arcorapay.xyz"
            target="_blank"
            rel="noopener noreferrer"
            className="hidden sm:inline text-sm text-arcora-muted-fg hover:text-arcora-slate transition-colors"
          >
            Powered by Arcora ↗
          </a>
          <Link
            href="/cart"
            className="relative inline-flex items-center gap-2 px-4 py-2 rounded-full border border-arcora-border hover:bg-arcora-gray transition-colors text-sm font-semibold"
          >
            <ShoppingBag className="size-4" />
            <span>Cart</span>
            {count > 0 && (
              <span className="ml-1 inline-flex items-center justify-center w-5 h-5 text-[10px] font-bold rounded-full bg-arcora-slate text-white tabular-nums">
                {count}
              </span>
            )}
          </Link>
        </nav>
      </div>
    </header>
  );
}

function ArcoraMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <path d="M16 4 L4 28 L11 28 L16 16 L21 28 L28 28 Z" fill="#2563ff" />
      <path d="M9 22 Q16 14 23 22" stroke="#00c2a8" strokeWidth="2.5" fill="none" strokeLinecap="round" />
    </svg>
  );
}
