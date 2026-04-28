import { ConnectMerchantButton } from "@/components/merchant/ConnectMerchantButton";

export default function LoginPage() {
  return (
    <main className="min-h-screen grid place-items-center px-6">
      <div className="max-w-md text-center space-y-8">
        <h1 className="font-[family-name:var(--font-display)] text-[52px] leading-[1.00]">
          Sign in to Arcora
        </h1>
        <p className="text-muted-foreground">
          Connect your wallet to manage invoices and webhooks.
        </p>
        <ConnectMerchantButton />
      </div>
    </main>
  );
}
