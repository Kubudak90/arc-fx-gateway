"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArcoraLogo } from "@/components/brand/Logo";
import { SiteFooter } from "@/components/landing/SiteFooter";

/**
 * Stand-alone, fully simulated checkout walkthrough — no wallet, no chain
 * call. The math behind every step uses real Arcora constants (1.0863 oracle
 * rate, 4 bps pool fee, 10 bps protocol fee) so the numbers a viewer sees
 * match what they'd see in a real /i/[invoiceId] flow on Arc testnet. The
 * interactive stepper lets a marketing visitor walk Invoice → Wallet →
 * Quote → Pay → Settled at their own pace.
 */

const ORACLE = 1.0863;
const POOL_FEE_BPS = 4;
const PROTOCOL_FEE_BPS = 10;

type Source = "USDC" | "EURC";

const STEPS = ["Invoice", "Wallet", "Quote", "Pay", "Settled"] as const;
type Step = (typeof STEPS)[number];

export default function CheckoutDemoPage() {
  const [stepIdx, setStepIdx] = useState(0);
  const [source, setSource]   = useState<Source>("USDC");
  const [paying, setPaying]   = useState(false);
  const [quoteSecs, setQuoteSecs] = useState(90);

  const merchant = { name: "Lumen Apparel", desc: "Order #ord_8124 · 2 items" };
  const invoice  = { amount: 49.0, currency: "USD", settle: "USDC" };

  // 1 EUR = ORACLE USD. So to deliver $X USDC the EURC payer needs $X / ORACLE
  // EUR before pool fees; same-token USDC payers pay the gross 1:1. Pool fee is
  // baked in by lifting the EURC input slightly so the post-swap output still
  // hits invoice.amount.
  const sourceAmountBeforePoolFee =
    source === "USDC" ? invoice.amount : invoice.amount / ORACLE;
  const sourceAmount =
    source === "USDC"
      ? invoice.amount
      : sourceAmountBeforePoolFee / (1 - POOL_FEE_BPS / 10_000);
  const fee = (invoice.amount * PROTOCOL_FEE_BPS) / 10_000;
  const merchantPayout = invoice.amount - fee;

  // Quote countdown
  useEffect(() => {
    const step = STEPS[stepIdx]!;
    if (step !== "Quote" && step !== "Pay") return;
    const id = setInterval(() => setQuoteSecs(s => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [stepIdx]);

  useEffect(() => {
    if (STEPS[stepIdx] === "Quote") setQuoteSecs(90);
  }, [stepIdx]);

  function reset() {
    setStepIdx(0);
    setPaying(false);
    setQuoteSecs(90);
  }

  function step(): Step {
    return STEPS[stepIdx]!;
  }

  return (
    <main className="min-h-screen flex flex-col bg-white">
      <header className="px-6 py-4 flex items-center justify-between border-b border-arcora-border">
        <Link href="/" className="flex items-center"><ArcoraLogo size={26} /></Link>
        <span className="font-[family-name:var(--font-mono)] text-[10px] tracking-[0.2em] uppercase text-muted-foreground">
          Checkout demo · simulated · no wallet required
        </span>
        <button onClick={reset} className="text-xs text-arcora-link hover:underline">
          Reset
        </button>
      </header>

      <section className="flex-1 px-6 py-10">
        <div className="max-w-4xl mx-auto">
          <Stepper current={stepIdx} />

          <div className="mt-8 grid grid-cols-1 md:grid-cols-[1fr_320px] gap-6 items-start">
            {/* Active step panel */}
            <div className="rounded-[20px] border border-arcora-border bg-white shadow-[0_20px_40px_-24px_rgba(11,20,38,0.10)] p-8 min-h-[520px]">
              {step() === "Invoice"  && <StepInvoice merchant={merchant} invoice={invoice} onNext={() => setStepIdx(1)} />}
              {step() === "Wallet"   && <StepWallet  source={source} setSource={setSource} onNext={() => setStepIdx(2)} />}
              {step() === "Quote"    && <StepQuote   source={source} sourceAmount={sourceAmount} fee={fee} merchantPayout={merchantPayout} quoteSecs={quoteSecs} onPay={() => { setPaying(true); setStepIdx(3); setTimeout(() => setStepIdx(4), 3200); }} />}
              {step() === "Pay"      && <StepPaying  source={source} />}
              {step() === "Settled"  && <StepSettled merchant={merchant} invoice={invoice} source={source} sourceAmount={sourceAmount} merchantPayout={merchantPayout} fee={fee} onReset={reset} />}
            </div>

            {/* Order summary rail */}
            <OrderSummary merchant={merchant} invoice={invoice} source={source} sourceAmount={sourceAmount} fee={fee} step={step()} quoteSecs={quoteSecs} />
          </div>
        </div>
      </section>

      <div className="border-t border-arcora-border px-6 py-5 text-[11px] text-muted-foreground flex items-center justify-between font-[family-name:var(--font-mono)]">
        <span>Numbers above use the live Chainlink oracle rate ({ORACLE}) and the deployed contract&apos;s fee config.</span>
        <Link href="/" className="text-arcora-link hover:underline">← Back to landing</Link>
      </div>
      <SiteFooter />
    </main>
  );
}

/* ── Stepper ─────────────────────────────────────────────────────────── */
function Stepper({ current }: { current: number }) {
  return (
    <div className="flex items-center gap-0">
      {STEPS.map((s, i) => {
        const done   = i <  current;
        const active = i === current;
        return (
          <div key={s} className="flex items-center gap-2 flex-1">
            <div className="flex items-center gap-2">
              <span className={`size-6 rounded-full flex items-center justify-center font-[family-name:var(--font-mono)] text-[11px] font-semibold ${
                done   ? "bg-arcora-teal text-white" :
                active ? "bg-arcora-blue text-white" :
                         "bg-arcora-gray text-muted-foreground"
              }`}>
                {done ? "✓" : i + 1}
              </span>
              <span className={`text-sm ${active ? "text-arcora-slate font-semibold" : "text-muted-foreground"}`}>
                {s}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <span className={`flex-1 h-px ${done ? "bg-arcora-teal" : "bg-arcora-border"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ── Step 1: Invoice ─────────────────────────────────────────────────── */
function StepInvoice({ merchant, invoice, onNext }: {
  merchant: { name: string; desc: string }; invoice: { amount: number; currency: string; settle: string }; onNext: () => void;
}) {
  return (
    <div className="flex flex-col h-full">
      <p className="font-[family-name:var(--font-mono)] text-[10px] tracking-[0.18em] uppercase text-muted-foreground">Step 1 · Invoice</p>
      <h2 className="mt-3 font-[family-name:var(--font-display)] text-[28px] tracking-tight text-arcora-slate">
        Pay {merchant.name}
      </h2>
      <p className="mt-1 text-muted-foreground">{merchant.desc}</p>

      <div className="mt-6 rounded-2xl bg-arcora-gray/40 border border-arcora-border p-6 flex items-baseline justify-between">
        <span className="font-[family-name:var(--font-mono)] text-xs tracking-wider uppercase text-muted-foreground">Total due</span>
        <span className="font-[family-name:var(--font-display)] text-3xl font-semibold tabular-nums text-arcora-slate">
          ${invoice.amount.toFixed(2)} <span className="text-base text-muted-foreground">{invoice.currency}</span>
        </span>
      </div>

      <p className="mt-6 text-sm text-muted-foreground">
        Merchant receives in <span className="text-arcora-slate font-semibold">{invoice.settle}</span> on Arc, regardless
        of which stablecoin you choose to pay with.
      </p>

      <button onClick={onNext} className="mt-auto btn-arcora-pill self-start">
        Continue → connect wallet
      </button>
    </div>
  );
}

/* ── Step 2: Wallet ──────────────────────────────────────────────────── */
function StepWallet({ source, setSource, onNext }: {
  source: Source; setSource: (s: Source) => void; onNext: () => void;
}) {
  return (
    <div className="flex flex-col h-full">
      <p className="font-[family-name:var(--font-mono)] text-[10px] tracking-[0.18em] uppercase text-muted-foreground">Step 2 · Wallet</p>
      <h2 className="mt-3 font-[family-name:var(--font-display)] text-[28px] tracking-tight text-arcora-slate">
        Choose how you want to pay
      </h2>

      <div className="mt-6 grid grid-cols-2 gap-3">
        {(["USDC", "EURC"] as const).map(s => (
          <button
            key={s}
            onClick={() => setSource(s)}
            className={`rounded-2xl border p-5 text-left transition-colors ${
              source === s
                ? "border-arcora-blue bg-arcora-blue/5"
                : "border-arcora-border hover:border-muted-foreground"
            }`}
          >
            <div className="font-[family-name:var(--font-display)] text-xl font-semibold text-arcora-slate">{s}</div>
            <div className="mt-1 text-xs text-muted-foreground">on Arc testnet</div>
            <div className="mt-3 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="size-1.5 rounded-full bg-arcora-teal" /> Available
            </div>
          </button>
        ))}
      </div>

      <p className="mt-5 text-sm text-muted-foreground max-w-md">
        Real Arcora connects via SIWE / wagmi — this demo skips the signature so you can step
        through the flow.
      </p>

      <div aria-hidden className="flex-1 min-h-12" />
      <button onClick={onNext} className="btn-arcora-pill self-start">
        Connect &amp; continue →
      </button>
    </div>
  );
}

/* ── Step 3: Quote ───────────────────────────────────────────────────── */
function StepQuote({ source, sourceAmount, fee, merchantPayout, quoteSecs, onPay }: {
  source: Source; sourceAmount: number; fee: number; merchantPayout: number; quoteSecs: number; onPay: () => void;
}) {
  const expired = quoteSecs <= 0;
  const sameToken = source === "USDC";
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-baseline justify-between">
        <p className="font-[family-name:var(--font-mono)] text-[10px] tracking-[0.18em] uppercase text-muted-foreground">Step 3 · Quote</p>
        <span className={`font-[family-name:var(--font-mono)] text-xs tabular-nums ${expired ? "text-red-600" : "text-muted-foreground"}`}>
          quote ttl · {quoteSecs.toString().padStart(2, "0")}s
        </span>
      </div>
      <h2 className="mt-3 font-[family-name:var(--font-display)] text-[26px] tracking-tight text-arcora-slate">
        Live FX, signed by Chainlink
      </h2>

      <div className="mt-6 rounded-2xl border border-arcora-border bg-arcora-gray/30 p-6 space-y-3 font-[family-name:var(--font-mono)] text-sm">
        <Row label="You pay"          value={`${sourceAmount.toFixed(4)} ${source}`} />
        <Row label="Merchant gets"    value={`$${merchantPayout.toFixed(2)} USDC`} highlight />
        <Row label="Oracle rate"      value={sameToken ? "— same-token, no swap" : `1 EUR = ${ORACLE.toFixed(4)} USD`} muted />
        <Row
          label={`Pool fee · ${POOL_FEE_BPS} bps`}
          value={sameToken ? "— same-token, no swap" : "embedded in quote"}
          muted
        />
        <Row label={`Protocol fee · ${PROTOCOL_FEE_BPS} bps`} value={`$${fee.toFixed(2)}`} muted />
      </div>

      <button onClick={onPay} disabled={expired} className="mt-auto btn-arcora-pill self-start disabled:opacity-50 disabled:cursor-not-allowed">
        {expired ? "Quote expired — refresh" : `Approve & pay ${sourceAmount.toFixed(4)} ${source}`}
      </button>
    </div>
  );
}

/* ── Step 4: Paying ──────────────────────────────────────────────────── */
function StepPaying({ source }: { source: Source }) {
  return (
    <div className="flex flex-col h-full justify-center items-center gap-6">
      <div className="size-14 rounded-full border-4 border-arcora-border border-t-arcora-blue animate-spin" />
      <div className="text-center">
        <p className="font-[family-name:var(--font-mono)] text-[10px] tracking-[0.18em] uppercase text-muted-foreground">Step 4 · Pay</p>
        <h2 className="mt-3 font-[family-name:var(--font-display)] text-[26px] tracking-tight text-arcora-slate">
          Submitting one transaction
        </h2>
        <p className="mt-2 text-sm text-muted-foreground max-w-md">
          {source === "USDC"
            ? "Same-token branch: gateway transfers USDC straight to the merchant — no swap, no slippage."
            : "Atomic flow: Gateway pulls EURC, OracleAMM swaps to USDC, payout fires to the merchant."}
        </p>
      </div>
    </div>
  );
}

/* ── Step 5: Settled ─────────────────────────────────────────────────── */
function StepSettled({ merchant, invoice, source, sourceAmount, merchantPayout, fee, onReset }: {
  merchant: { name: string }; invoice: { amount: number; settle: string };
  source: Source; sourceAmount: number; merchantPayout: number; fee: number;
  onReset: () => void;
}) {
  return (
    <div className="flex flex-col h-full">
      <p className="font-[family-name:var(--font-mono)] text-[10px] tracking-[0.18em] uppercase text-arcora-teal">Step 5 · Settled</p>
      <h2 className="mt-3 font-[family-name:var(--font-display)] text-[28px] tracking-tight text-arcora-slate">
        Payment confirmed.
      </h2>
      <p className="mt-2 text-muted-foreground">
        {merchant.name} received <span className="text-arcora-slate font-semibold">${merchantPayout.toFixed(2)} {invoice.settle}</span> on Arc —
        the InvoicePaid webhook is on its way.
      </p>

      <div className="mt-6 rounded-2xl border border-arcora-border bg-arcora-gray/30 p-6 space-y-3 font-[family-name:var(--font-mono)] text-sm">
        <Row label="You paid"        value={`${sourceAmount.toFixed(4)} ${source}`} />
        <Row label="Invoice gross"   value={`$${invoice.amount.toFixed(2)} ${invoice.settle}`} muted />
        <Row label="Protocol fee"    value={`$${fee.toFixed(2)} ${invoice.settle}`} muted />
        <Row label="Merchant payout" value={`$${merchantPayout.toFixed(2)} ${invoice.settle}`} highlight />
        <Row label="Tx hash"         value="0x…simulated" muted />
        <Row label="Webhook"         value="invoice.paid · queued" muted />
      </div>

      <div className="mt-auto flex gap-3 pt-6 flex-wrap">
        <button onClick={onReset} className="btn-arcora-pill-light">Run it again</button>
        <Link href="/m/dashboard" className="btn-arcora-pill">Open merchant dashboard →</Link>
      </div>
    </div>
  );
}

/* ── Order summary rail ──────────────────────────────────────────────── */
function OrderSummary({ merchant, invoice, source, sourceAmount, fee, step, quoteSecs }: {
  merchant: { name: string }; invoice: { amount: number; settle: string };
  source: Source; sourceAmount: number; fee: number;
  step: Step; quoteSecs: number;
}) {
  return (
    <aside className="rounded-[20px] border border-arcora-border bg-white p-6 sticky top-6">
      <div className="font-[family-name:var(--font-mono)] text-[10px] tracking-[0.18em] uppercase text-muted-foreground mb-4">
        Order summary
      </div>
      <div className="space-y-3 text-sm">
        <Row label={merchant.name} value={`$${invoice.amount.toFixed(2)}`} />
        <hr className="border-arcora-border" />
        <Row label="Total"  value={`$${invoice.amount.toFixed(2)} ${invoice.settle}`} highlight />
      </div>

      <div className="mt-5 pt-5 border-t border-arcora-border space-y-2 text-[12px] font-[family-name:var(--font-mono)]">
        <Row label="You pay" value={`${sourceAmount.toFixed(4)} ${source}`} muted />
        <Row label="Protocol fee" value={`$${fee.toFixed(2)}`} muted />
        {(step === "Quote" || step === "Pay") && (
          <Row label="Quote ttl" value={`${quoteSecs}s`} muted />
        )}
      </div>
    </aside>
  );
}

function Row({ label, value, highlight, muted }: { label: string; value: string; highlight?: boolean; muted?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className={muted ? "text-muted-foreground" : "text-muted-foreground"}>{label}</span>
      <span className={`tabular-nums ${
        highlight ? "text-arcora-slate font-semibold" :
        muted     ? "text-muted-foreground" : "text-arcora-slate"
      }`}>
        {value}
      </span>
    </div>
  );
}
