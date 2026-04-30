"use client";

import type { ReactNode } from "react";

/**
 * "Four lines, first settlement" — port of the design's SDK code block. Pure
 * marketing visual, no live data; the snippet uses real `@arcora/sdk` exports
 * so a developer reading it can paste-run it.
 */

const CODE = `import { Arcora } from '@arcora/sdk';

const arcora = new Arcora({ apiKey: process.env.ARCORA_KEY });

// Create an invoice — customer pays in any stable, you settle in USDC
const invoice = await arcora.invoices.create({
  amount: { value: '49.00', currency: 'USD' },
  settle: 'USDC',
  metadata: { orderId: 'ord_8124' },
});

return Response.redirect(invoice.checkoutUrl);`;

const KEYWORDS  = new Set(["import", "from", "const", "await", "return", "new", "process", "env"]);
const TYPENAMES = new Set(["Arcora", "Response"]);

const C_STRING  = "#00c2a8";
const C_COMMENT = "#9aa1ae";
const C_KEYWORD = "#7c5cff";
const C_TYPE    = "#d97706";
const C_METHOD  = "#0288c0";

/**
 * Tokenize a single line into colored React spans. Replaces the original
 * dangerouslySetInnerHTML approach so static analysis stays quiet. Grammar is
 * deliberately tiny — the input is one hard-coded snippet.
 */
function highlightLine(line: string, keyPrefix: string): ReactNode[] {
  if (line.length === 0) return [<span key={keyPrefix}>&nbsp;</span>];

  // Match priority: comment → string → identifier-followed-by-paren → identifier → other.
  const re = /(\/\/.*$)|('[^']*')|([A-Za-z_][A-Za-z0-9_]*)(?=\()|([A-Za-z_][A-Za-z0-9_]*)|([\s\S])/g;

  const out: ReactNode[] = [];
  let i = 0;
  for (const m of line.matchAll(re)) {
    const [, comment, str, methodIdent, ident, other] = m;
    let node: ReactNode;
    if (comment !== undefined) {
      node = <span style={{ color: C_COMMENT, fontStyle: "italic" }}>{comment}</span>;
    } else if (str !== undefined) {
      node = <span style={{ color: C_STRING }}>{str}</span>;
    } else if (methodIdent !== undefined) {
      const c =
        KEYWORDS.has(methodIdent) ? C_KEYWORD :
        TYPENAMES.has(methodIdent) ? C_TYPE :
        C_METHOD;
      node = <span style={{ color: c }}>{methodIdent}</span>;
    } else if (ident !== undefined) {
      const c =
        KEYWORDS.has(ident) ? C_KEYWORD :
        TYPENAMES.has(ident) ? C_TYPE :
        undefined;
      node = c ? <span style={{ color: c }}>{ident}</span> : ident;
    } else {
      node = other;
    }
    out.push(<span key={keyPrefix + ":" + i++}>{node}</span>);
  }
  return out;
}

export function SDKBlock() {
  const lines = CODE.split("\n");

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.3fr] gap-12 items-center">
      <div>
        <p className="font-[family-name:var(--font-mono)] text-[11px] tracking-[0.18em] uppercase text-muted-foreground">
          Developers
        </p>
        <h2 className="mt-3 font-[family-name:var(--font-display)] text-[44px] leading-[1.05] tracking-tight text-arcora-slate">
          Four lines.<br />First settlement.
        </h2>
        <p className="mt-5 text-muted-foreground leading-relaxed">
          Drop in the npm SDK, point a webhook at your worker, and you&apos;re collecting stablecoin volume.
          TypeScript-first, framework-agnostic, batteries included.
        </p>
        <div className="mt-7 flex gap-2 flex-wrap">
          <a
            href="https://www.npmjs.com/package/@arcora/sdk"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-arcora-border bg-white text-sm font-medium text-arcora-slate hover:border-muted-foreground transition-colors"
          >
            <span className="font-[family-name:var(--font-mono)] text-[11px] text-muted-foreground tracking-wider">$</span>
            npm install @arcora/sdk
          </a>
          <a
            href="https://github.com/Kubudak90/arc-fx-gateway/tree/plan-1-protocol/packages/sdk#readme"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center px-4 py-2.5 rounded-lg border border-arcora-border bg-transparent text-sm font-medium text-arcora-slate hover:border-muted-foreground transition-colors"
          >
            Read the docs
          </a>
        </div>
      </div>

      <div className="rounded-[16px] border border-arcora-border bg-white overflow-hidden shadow-[0_20px_40px_-24px_rgba(11,20,38,0.12)]">
        <div className="flex items-center justify-between px-4 py-3 bg-arcora-gray/40 border-b border-arcora-border">
          <div className="flex gap-1.5">
            <span className="size-2.5 rounded-full bg-arcora-border" />
            <span className="size-2.5 rounded-full bg-arcora-border" />
            <span className="size-2.5 rounded-full bg-arcora-border" />
          </div>
          <span className="font-[family-name:var(--font-mono)] text-[11px] text-muted-foreground">routes/checkout.ts</span>
          <span className="font-[family-name:var(--font-mono)] text-[11px] text-muted-foreground">TypeScript</span>
        </div>
        <pre className="px-5 py-5 m-0 text-[12.5px] leading-[1.7] font-[family-name:var(--font-mono)] text-arcora-slate overflow-auto bg-white">
          {lines.map((l, idx) => (
            <div key={idx} className="flex gap-4">
              <span className="text-muted-foreground/60 select-none w-5 text-right tabular-nums">{idx + 1}</span>
              <span>{highlightLine(l, String(idx))}</span>
            </div>
          ))}
        </pre>
      </div>
    </div>
  );
}
