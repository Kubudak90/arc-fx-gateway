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
    <div className="grid grid-cols-1 lg:grid-cols-[0.85fr_1.15fr] gap-12 lg:gap-16 items-start">
      <div>
        <p className="eyebrow mb-4">Developers</p>
        <h2 className="font-[family-name:var(--font-display)] font-light text-[48px] sm:text-[56px] leading-[1.04] tracking-[-0.025em] text-arcora-slate text-balance">
          Four lines.<br /><em className="not-italic italic font-[family-name:var(--font-display)]">First settlement.</em>
        </h2>
        <p className="mt-6 text-[16px] text-arcora-muted-fg leading-[1.55] max-w-[440px]">
          Drop in the npm SDK, point a webhook at your worker, and you&apos;re collecting stablecoin volume.
          TypeScript-first, framework-agnostic, batteries included.
        </p>
        <div className="mt-8 flex gap-2 flex-wrap">
          <a
            href="https://www.npmjs.com/package/@arcora/sdk"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-4 py-2.5 border border-arcora-border bg-white text-[13px] font-medium text-arcora-slate hover:border-arcora-muted-fg transition-colors"
          >
            <span className="font-[family-name:var(--font-mono)] text-[11px] text-arcora-muted-fg tracking-wider">$</span>
            npm install @arcora/sdk
          </a>
          <a
            href="https://github.com/Kubudak90/arc-fx-gateway/tree/plan-1-protocol/packages/sdk#readme"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center px-4 py-2.5 border border-arcora-border bg-transparent text-[13px] font-medium text-arcora-slate hover:border-arcora-muted-fg transition-colors"
          >
            Read the docs
          </a>
        </div>
      </div>

      <div className="border border-arcora-border bg-white overflow-hidden shadow-[0_8px_30px_rgba(15,23,42,0.08)]">
        <div className="flex items-center justify-between px-4 py-3 bg-arcora-gray/30 border-b border-arcora-border">
          <div className="flex">
            {["routes/checkout.ts", ""].map((tab, i) => (
              tab ? (
                <span key={i} className={`font-[family-name:var(--font-mono)] text-[11px] px-4 py-1.5 border-r border-arcora-border ${i === 0 ? "text-arcora-slate bg-white border-b-0" : "text-arcora-muted-fg"}`}>
                  {tab}
                </span>
              ) : null
            ))}
          </div>
          <span className="font-[family-name:var(--font-mono)] text-[11px] text-arcora-muted-fg">TypeScript</span>
        </div>
        <pre className="px-5 py-5 m-0 text-[12.5px] leading-[1.7] font-[family-name:var(--font-mono)] text-arcora-slate overflow-auto bg-white">
          {lines.map((l, idx) => (
            <div key={idx} className="flex gap-4">
              <span className="text-arcora-muted-fg/40 select-none w-5 text-right tabular-nums">{idx + 1}</span>
              <span>{highlightLine(l, String(idx))}</span>
            </div>
          ))}
        </pre>
      </div>
    </div>
  );
}
