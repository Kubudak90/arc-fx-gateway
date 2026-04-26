"use client";

interface CheckoutClientProps {
  invoiceId: string;
  initialStatus: "created" | "paid" | "expired";
  payInTokenAddress: string;
  payoutTokenAddress: string;
  amountOut: string;
  successUrl: string;
  cancelUrl?: string;
}

export default function CheckoutClient(_props: CheckoutClientProps) {
  return <div className="text-sm text-muted-foreground">Checkout client — Task 4 fills this.</div>;
}
