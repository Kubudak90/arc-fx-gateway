import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getSession } from "@/lib/auth/session";
import Link from "next/link";
import type { Route } from "next";
import { ArcoraLogo } from "@/components/brand/Logo";
import { MerchantSidebar } from "@/components/merchant/MerchantSidebar";

export default async function MerchantLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  const path = (await headers()).get("x-pathname") ?? "";
  if (!session.merchantAddress && !path.endsWith("/m/login")) {
    redirect("/m/login");
  }

  if (!session.merchantAddress) {
    return <>{children}</>;
  }

  return (
    <div className="md:grid md:grid-cols-[232px_1fr] min-h-screen bg-[#fafafb]">
      <MerchantSidebar merchantAddress={session.merchantAddress} />

      <div className="min-w-0">
        {/* Mobile top bar — sidebar is hidden below md */}
        <div className="md:hidden flex items-center justify-between px-4 py-3 border-b border-arcora-border bg-white">
          <Link href={"/m/dashboard" as Route} aria-label="Arcora home">
            <ArcoraLogo size={22} />
          </Link>
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <span className="mono text-[12px]">
              {session.merchantAddress.slice(0, 6)}…{session.merchantAddress.slice(-4)}
            </span>
            <form action="/api/auth/logout" method="POST">
              <button type="submit" className="text-arcora-link hover:underline">Sign out</button>
            </form>
          </div>
        </div>

        {children}
      </div>
    </div>
  );
}
