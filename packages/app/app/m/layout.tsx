import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getSession } from "@/lib/auth/session";
import Link from "next/link";
import type { Route } from "next";

export default async function MerchantLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  const path = (await headers()).get("x-pathname") ?? "";
  if (!session.merchantAddress && !path.endsWith("/m/login")) {
    redirect("/m/login");
  }

  return (
    <>
      {session.merchantAddress && (
        <nav className="border-b border-cb-muted-blue px-6 py-4 flex items-center justify-between">
          <div className="flex gap-6">
            <Link href={"/m/dashboard" as Route} className="font-semibold">Dashboard</Link>
            <Link href={"/m/settings" as Route} className="text-muted-foreground hover:text-foreground">Settings</Link>
          </div>
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <span className="font-mono">{session.merchantAddress.slice(0, 6)}…{session.merchantAddress.slice(-4)}</span>
            <form action="/api/auth/logout" method="POST">
              <button type="submit" className="text-cb-link hover:underline">Sign out</button>
            </form>
          </div>
        </nav>
      )}
      {children}
    </>
  );
}
