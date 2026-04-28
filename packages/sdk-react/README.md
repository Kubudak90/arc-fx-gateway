# @arcora/react

React bindings for [`@arcora/sdk`](https://www.npmjs.com/package/@arcora/sdk) — drop-in `<CheckoutButton />` and `useCheckout()` hook for Arcora stablecoin payments on Arc Network.

## Install

```bash
npm install @arcora/react @arcora/sdk
# or
pnpm add @arcora/react @arcora/sdk
```

`@arcora/sdk` is a peer dependency.

## Quick start

```tsx
import { CheckoutButton } from "@arcora/react";

export function Checkout() {
  return (
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
  );
}
```

## Hook

For more control, use `useCheckout`:

```tsx
import { useCheckout } from "@arcora/react";

function Pay() {
  const { checkout, loading, error } = useCheckout({
    apiKey: "ak_live_...",
    environment: "testnet",
  });

  return (
    <>
      <button onClick={() => checkout({
        amountUsdc: 49.99,
        payInToken: "EURC",
        successUrl: window.location.origin + "/success",
      })} disabled={loading}>
        {loading ? "Loading..." : "Pay €49.99"}
      </button>
      {error && <p>{error.message}</p>}
    </>
  );
}
```

## Props / hook options

`<CheckoutButton />` accepts every option `Arcora.init` accepts (`apiKey`, `environment`, `baseUrl`) plus an `invoice` object matching `Arcora.createInvoice` params, plus standard React `children` and `className`.

`useCheckout(initOpts)` returns `{ checkout, loading, error }`. `checkout(invoice)` calls `Arcora.createInvoice` then `Arcora.openCheckout` (browser redirect). `error` is an `ArcoraError` instance.

## Source

[github.com/Kubudak90/arc-fx-gateway](https://github.com/Kubudak90/arc-fx-gateway) — `packages/sdk-react/`

## License

MIT.
