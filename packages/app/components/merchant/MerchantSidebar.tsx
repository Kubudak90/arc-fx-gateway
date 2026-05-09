"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Route } from "next";
import { ArcoraLogo } from "@/components/brand/Logo";

const NAV_ITEMS = [
  { id: "overview",   label: "Overview",   href: "/m/dashboard",  icon: "M3 12L12 3l9 9M5 10v10h14V10" },
  { id: "treasury",   label: "Treasury",   href: "/m/treasury",   icon: "M4 7h16v12H4zM4 11h16M9 15h2" },
  { id: "compliance", label: "Compliance", href: "/m/compliance", icon: "M12 2L4 6v6c0 5 3.4 9.4 8 10 4.6-.6 8-5 8-10V6l-8-4z" },
  { id: "settings",   label: "Settings",   href: "/m/settings",   icon: "M12 8a4 4 0 100 8 4 4 0 000-8zM19 12l2 1-2 1M5 12l-2 1 2 1M12 5l1-2 1 2M12 19l1 2 1-2" },
] as const;

const ARC_CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 5042002);
// Production chain id will differ; until then treat as testnet.
const IS_TESTNET = ARC_CHAIN_ID !== 1;

interface Props {
  merchantAddress: string;
}

export function MerchantSidebar({ merchantAddress }: Props) {
  const pathname = usePathname() ?? "";
  const initials = merchantAddress.slice(2, 4).toUpperCase();
  const shortAddr = `${merchantAddress.slice(0, 6)}…${merchantAddress.slice(-4)}`;

  return (
    <aside className="hidden md:flex flex-col w-[232px] shrink-0 px-4 py-6 gap-1 bg-[#fbfafa] border-r border-arcora-border min-h-screen sticky top-0 self-start">
      <Link href={"/m/dashboard" as Route} aria-label="Arcora home" className="px-2.5 pb-3 inline-flex">
        <ArcoraLogo size={22} />
      </Link>

      <div className="px-2.5 pb-3.5 flex flex-col gap-1.5">
        <span className="eyebrow">Merchant</span>
        <div className="flex items-center gap-2.5">
          <div className="w-[30px] h-[30px] rounded-lg bg-arcora-blue/10 text-arcora-blue flex items-center justify-center mono font-bold text-[12px]">
            {initials}
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-[13px] font-medium truncate">{shortAddr}</span>
            <span className="mono text-[10.5px] text-arcora-muted-fg">arc · {IS_TESTNET ? "testnet" : "live"}</span>
          </div>
        </div>
      </div>

      <div className="hairline my-2" />

      <nav className="flex flex-col gap-0.5">
        {NAV_ITEMS.map(item => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.id}
              href={item.href as Route}
              className={[
                "flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13.5px] transition-colors",
                active
                  ? "bg-arcora-gray text-arcora-slate font-medium"
                  : "text-arcora-deep hover:bg-arcora-gray/60",
              ].join(" ")}
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d={item.icon} />
              </svg>
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto pt-3 flex flex-col gap-2">
        {IS_TESTNET && (
          <div className="p-3 border border-arcora-border rounded-[10px] bg-white">
            <div className="flex items-center gap-1.5 mb-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-arcora-blue" />
              <span className="mono text-[10.5px] text-arcora-muted-fg tracking-wider">ARC TESTNET</span>
            </div>
            <p className="text-[11.5px] text-arcora-deep leading-snug m-0">
              You&apos;re on testnet. Switch network to go live.
            </p>
          </div>
        )}
        <form action="/api/auth/logout" method="POST" className="px-2.5">
          <button type="submit" className="text-arcora-link hover:underline text-[12px]">
            Sign out
          </button>
        </form>
      </div>
    </aside>
  );
}
