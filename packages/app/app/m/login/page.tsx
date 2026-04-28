import { ConnectMerchantButton } from "@/components/merchant/ConnectMerchantButton";
import { ArcoraLogo } from "@/components/brand/Logo";

export default function LoginPage() {
  return (
    <main className="min-h-screen grid place-items-center px-6">
      <div className="max-w-md text-center space-y-8">
        <ArcoraLogo size={56} className="justify-center" />
        <div className="space-y-3">
          <h1 className="font-[family-name:var(--font-display)] text-[44px] leading-[1.05] tracking-tight text-arcora-slate">
            Sign in to Arcora
          </h1>
          <p className="text-muted-foreground">
            Connect your wallet to manage invoices and webhooks.
          </p>
        </div>
        <ConnectMerchantButton />
      </div>
    </main>
  );
}
