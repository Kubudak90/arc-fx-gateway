# @arc-fx/checkout

Stripe-style checkout SDK for the [Arc FX Gateway](https://github.com/Kubudak90/arc-fx-gateway) — USDC ⇄ EURC payments on Arc Network. Three functions, zero EVM dependencies, ~1.5 KB gzipped.

## Install

```bash
npm install @arc-fx/checkout
```

For React: `npm install @arc-fx/checkout-react`

## Usage

```ts
import { ArcFX } from "@arc-fx/checkout";

ArcFX.init({ apiKey: "ak_live_...", environment: "testnet" });

const invoice = await ArcFX.createInvoice({
  amountUsdc: 49.99,
  payInToken: "EURC",
  successUrl: "https://my-store.com/success",
});

ArcFX.openCheckout(invoice);
```

### React

```tsx
import { CheckoutButton } from "@arc-fx/checkout-react";

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
import { useCheckout } from "@arc-fx/checkout-react";

const { checkout, loading, error } = useCheckout({ apiKey: "ak_live_..." });

<button onClick={() => checkout({ amountUsdc: 49.99, payInToken: "EURC", successUrl: "..." })}>
  {loading ? "Loading..." : "Pay €49.99"}
</button>
```

## API

### `ArcFX.init(options)`

| Option | Type | Required |
|--------|------|----------|
| `apiKey` | `string` | yes |
| `environment` | `"testnet" \| "mainnet"` | no, defaults to `testnet` |
| `baseUrl` | `string` | no, override per environment |

### `ArcFX.createInvoice(params)` → `Promise<{ invoiceId, url }>`

| Param | Type | Required |
|-------|------|----------|
| `amountUsdc` | `number` | yes — USD-equivalent amount, e.g. `49.99` |
| `payInToken` | `"USDC" \| "EURC"` | yes |
| `successUrl` | `string` | yes — http(s) URL |
| `cancelUrl` | `string` | no |
| `metadata` | `Record<string, string>` | no |

Throws `ArcFXError` on failure with discriminated `code`:
- `INVALID_API_KEY` — 401 from server
- `SERVER_ERROR` — 5xx (includes `retryAfter` if Retry-After header set)
- `NETWORK` — fetch failed
- `INVALID_URL` — non-http(s) successUrl/cancelUrl
- `TIMEOUT`, `UNKNOWN`

### `ArcFX.openCheckout(invoice)`

Redirects browser to `invoice.url`. Throws if not in browser environment.

## Error handling

```ts
try {
  await ArcFX.createInvoice({ ... });
} catch (e) {
  if (e instanceof ArcFXError) {
    if (e.code === "INVALID_API_KEY") /* ... */;
    if (e.code === "SERVER_ERROR" && e.retryAfter) /* ... */;
  }
}
```

## Live demo

[https://arc-fx-demo.vercel.app](https://arc-fx-demo.vercel.app) — pay in EURC on Arc testnet. Get test EURC from [faucet.circle.com](https://faucet.circle.com) (select Arc Testnet).

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
