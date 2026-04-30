# @arcora/sdk

Stripe-style checkout SDK for [Arcora](https://github.com/Kubudak90/arc-fx-gateway) — stablecoin payments on Arc Network. Three functions, zero EVM dependencies, ~1.5 KB gzipped.

## Install

```bash
npm install @arcora/sdk
# or
pnpm add @arcora/sdk
```

For React: `npm install @arcora/sdk-react`

### Drop-in `<script>` tag (no build step)

For sites without a bundler — static HTML, simple WordPress themes, anything that can host a script tag — use the IIFE bundle from a CDN:

```html
<script src="https://cdn.jsdelivr.net/npm/@arcora/sdk@1.1/dist/arcora.global.js"></script>
<script>
  Arcora.init({ apiKey: "ak_live_…", environment: "testnet" });
  document.getElementById("pay").addEventListener("click", async () => {
    const inv = await Arcora.createInvoice({
      amountUsdc: 49.99,
      payInToken: "EURC",
      successUrl: window.location.origin + "/?paid=1",
    });
    Arcora.openCheckout(inv);
  });
</script>
<button id="pay">Pay €49.99</button>
```

Same surface as the npm package, flattened onto a global `Arcora`. Works in any modern browser; ~1.8 KB minified.

## Usage

```ts
import { Arcora } from "@arcora/sdk";

Arcora.init({ apiKey: "ak_live_...", environment: "testnet" });

const invoice = await Arcora.createInvoice({
  amountUsdc: 49.99,
  payInToken: "EURC",
  successUrl: "https://my-store.com/success",
});

Arcora.openCheckout(invoice);
```

### React

```tsx
import { CheckoutButton } from "@arcora/sdk-react";

<CheckoutButton
  apiKey="ak_live_..."
  environment="testnet"
  invoice={{
    amountUsdc: 49.99,
    payInToken: "EURC",
    successUrl: "https://my-store.com/success",
  }}
>
  Pay €49.99
</CheckoutButton>
```

### Hook

```tsx
import { useCheckout } from "@arcora/sdk-react";

const { checkout, loading, error } = useCheckout({ apiKey: "ak_live_..." });

<button onClick={() => checkout({ amountUsdc: 49.99, payInToken: "EURC", successUrl: "..." })}>
  {loading ? "Loading..." : "Pay €49.99"}
</button>
```

## API

### `Arcora.init(options)`

| Option | Type | Required |
|--------|------|----------|
| `apiKey` | `string` | yes |
| `environment` | `"testnet" \| "mainnet"` | no, defaults to `testnet` |
| `baseUrl` | `string` | no, override per environment |

### `Arcora.createInvoice(params)` → `Promise<{ invoiceId, url }>`

| Param | Type | Required |
|-------|------|----------|
| `amountUsdc` | `number` | yes — USD-equivalent amount, e.g. `49.99` |
| `payInToken` | `"USDC" \| "EURC"` | yes |
| `successUrl` | `string` | yes — http(s) URL |
| `cancelUrl` | `string` | no |
| `metadata` | `Record<string, string>` | no |

Throws `ArcoraError` on failure with discriminated `code`:
- `INVALID_API_KEY` — 401 from server
- `SERVER_ERROR` — 5xx (includes `retryAfter` if Retry-After header set)
- `NETWORK` — fetch failed
- `INVALID_URL` — non-http(s) successUrl/cancelUrl
- `TIMEOUT`, `UNKNOWN`

### `Arcora.openCheckout(invoice)`

Redirects browser to `invoice.url`. Throws if not in a browser environment.

## Error handling

```ts
import { Arcora, ArcoraError } from "@arcora/sdk";

try {
  await Arcora.createInvoice({ ... });
} catch (e) {
  if (e instanceof ArcoraError) {
    if (e.code === "INVALID_API_KEY") /* ... */;
    if (e.code === "SERVER_ERROR" && e.retryAfter) /* ... */;
  }
}
```

## Live demo

[arc-fx-gateway.vercel.app](https://arc-fx-gateway.vercel.app) — pay in USDC or EURC on Arc testnet. Get test EURC from [faucet.circle.com](https://faucet.circle.com) (select Arc Testnet).

## Bundle

| File | Size |
|------|------|
| ESM (`dist/index.mjs`) | ~1.5 KB minified |
| CJS (`dist/index.js`) | ~1.5 KB minified |
| Types (`dist/index.d.ts`) | included |

Zero runtime dependencies. Tree-shake-safe (`sideEffects: false`).

## Source

[github.com/Kubudak90/arc-fx-gateway](https://github.com/Kubudak90/arc-fx-gateway) — `packages/sdk/`

## License

MIT.
