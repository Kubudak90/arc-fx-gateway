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
    <footer className="border-t border-arcora-border bg-white">
      <div className="max-w-5xl mx-auto px-6 sm:px-8 py-16 grid gap-12 grid-cols-1 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div className="flex flex-col gap-5 max-w-xs">
          <ArcoraLogo size={22} />
          <p className="text-[13px] text-arcora-muted-fg leading-[1.5] max-w-[280px]">
            Stablecoin checkout &amp; settlement infrastructure. Built on Arc.
          </p>
          <span className="font-[family-name:var(--font-mono)] text-[11px] text-arcora-muted-fg/80 tracking-[0.08em]">
            © 2026 Arcora · Arc testnet
          </span>
        </div>
        {COLUMNS.map(col => (
          <div key={col.title} className="flex flex-col gap-3">
            <p className="eyebrow">{col.title}</p>
            <ul className="flex flex-col gap-2.5">
              {col.items.map(it => (
                <li key={it.label}>
                  <a
                    href={it.href}
                    {...(it.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                    className="text-[13px] text-arcora-muted-fg hover:text-arcora-slate transition-colors"
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
        <div className="max-w-5xl mx-auto px-6 sm:px-8 py-4 flex items-center justify-between text-[11px] text-arcora-muted-fg/80 font-[family-name:var(--font-mono)] tracking-[0.06em]">
          <span>v1.1 · gateway 0x07BAC123…aE3a3 · arc testnet</span>
          <span><a href="https://docs.arcorapay.xyz" className="hover:text-arcora-link transition-colors">docs.arcorapay.xyz</a></span>
        </div>
      </div>
    </footer>
  );
}
