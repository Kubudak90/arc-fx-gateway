import { ArcoraLogo } from "@/components/brand/Logo";

/**
 * Multi-column site footer used on the marketing surfaces. Every link points
 * at something that actually exists today — no placeholder /about, /security,
 * /compliance pages that 404. We add those columns when the underlying pages
 * ship.
 */

interface FooterColumn {
  title: string;
  items: Array<{ label: string; href: string; external?: boolean }>;
}

const COLUMNS: FooterColumn[] = [
  {
    title: "Product",
    items: [
      { label: "Checkout demo", href: "/checkout-demo" },
      { label: "Merchant dashboard", href: "/m/dashboard" },
      { label: "Treasury", href: "/m/treasury" },
      { label: "Roadmap", href: "/#roadmap" },
    ],
  },
  {
    title: "Developers",
    items: [
      { label: "GitHub", href: "https://github.com/Kubudak90/arc-fx-gateway", external: true },
      { label: "@arcora/sdk", href: "https://www.npmjs.com/package/@arcora/sdk", external: true },
      { label: "@arcora/sdk-react", href: "https://www.npmjs.com/package/@arcora/sdk-react", external: true },
      { label: "Releases", href: "https://github.com/Kubudak90/arc-fx-gateway/releases", external: true },
    ],
  },
  {
    title: "Resources",
    items: [
      { label: "Live merchant demo", href: "https://arc-fx-demo.vercel.app", external: true },
      { label: "Pitch deck (PDF)", href: "https://github.com/Kubudak90/arc-fx-gateway/raw/plan-1-protocol/docs/arcora-pitch.pdf", external: true },
      { label: "Specs & plans", href: "https://github.com/Kubudak90/arc-fx-gateway/tree/plan-1-protocol/docs", external: true },
      { label: "CHANGELOG", href: "https://github.com/Kubudak90/arc-fx-gateway/blob/plan-1-protocol/CHANGELOG.md", external: true },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-arcora-border bg-arcora-gray/20">
      <div className="max-w-5xl mx-auto px-6 py-14 grid gap-10 grid-cols-1 md:grid-cols-[minmax(0,1.2fr)_repeat(3,minmax(0,1fr))]">
        <div className="flex flex-col gap-4 max-w-xs">
          <ArcoraLogo size={22} />
          <p className="text-sm text-muted-foreground leading-relaxed">
            Stablecoin checkout &amp; settlement infrastructure. Built on Arc.
          </p>
          <span className="font-[family-name:var(--font-mono)] text-[11px] text-muted-foreground/80 tracking-wider">
            © 2026 Arcora · Arc testnet
          </span>
        </div>
        {COLUMNS.map(col => (
          <div key={col.title} className="flex flex-col gap-3">
            <span className="font-[family-name:var(--font-mono)] text-[10px] tracking-[0.18em] uppercase text-muted-foreground">
              {col.title}
            </span>
            <ul className="flex flex-col gap-2.5">
              {col.items.map(it => (
                <li key={it.label}>
                  <a
                    href={it.href}
                    {...(it.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                    className="text-sm text-arcora-slate hover:text-arcora-link transition-colors"
                  >
                    {it.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-arcora-border">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between text-[11px] text-muted-foreground/80 font-[family-name:var(--font-mono)] tracking-wider">
          <span>v1.1 · gateway 0x07BAC123…aE3a3 · arc testnet</span>
          <span><a href="https://docs.arcorapay.xyz" className="hover:text-arcora-link">docs.arcorapay.xyz</a></span>
        </div>
      </div>
    </footer>
  );
}
