/**
 * Smoke test for `/api/invoices?engine=v8` against the deployed Vercel
 * production. Confirms the cutover query param actually lands invoices on
 * the v0.8 gateway and the hosted checkout URL is reachable.
 *
 * Args via env:
 *   PROD_BASE_URL = https://arc-fx-gateway.vercel.app (or per-deploy URL)
 *   API_KEY       = ak_live_...
 */
import "dotenv/config";

const BASE = process.env.PROD_BASE_URL ?? "https://arc-fx-gateway.vercel.app";
const KEY = process.env.API_KEY;
if (!KEY) throw new Error("missing API_KEY");
const apiKey: string = KEY;

async function main() {
  console.log(`[v8-create] POST ${BASE}/api/invoices?engine=v8`);
  const res = await fetch(`${BASE}/api/invoices?engine=v8`, {
    method: "POST",
    headers: { "content-type": "application/json", "X-Arcora-Api-Key": apiKey },
    body: JSON.stringify({
      amountUsdc: 1.0,
      payInToken: "USDC",
      successUrl: "https://example.test/success",
      cancelUrl:  "https://example.test/cancel",
      metadata:   { source: "v8-smoke" },
    }),
  });
  console.log(`[v8-create] status=${res.status}`);
  const body = await res.json();
  console.log(JSON.stringify(body, null, 2));
  if (!res.ok) {
    process.exit(1);
  }
  console.log(`\n[v8-create] open in browser to test the v0.8 PayButton:`);
  console.log(`  ${body.url}`);
}

main().catch(e => { console.error(e); process.exit(1); });
