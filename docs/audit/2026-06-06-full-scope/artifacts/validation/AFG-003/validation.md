# AFG-003 Validation: Shop checkout trusts client-supplied price and quantity

## Disposition

**Reportable.**

- **Severity:** Medium
- **Current-deployment qualifier:** Low direct monetary impact while the shop and settlement rail remain pre-revenue on Arc testnet; Medium if operators ship physical merchandise from paid invoice metadata, and potentially High if this flow is moved to real-value settlement or automated fulfillment unchanged.
- **Confidence:** High (0.95) for the source-to-sink vulnerability; Moderate for realized physical-goods loss because fulfillment is manual and no shipment evidence is present in the repository.
- **Validation method:** Focused code trace plus a local realistic-interface reproduction through the unmodified Next.js route with a mock Arcora upstream. No production invoice or chain transaction was created.

## Candidate identity

- **Candidate ID:** AFG-003
- **Instance key:** `shop-checkout-client-price-and-qty-trust`
- **Ledger row ID:** Not available in the provided worktree/artifact path
- **Seed/entrypoint:** `packages/shop/app/checkout/page.tsx:45`
- **Root control:** `packages/shop/app/api/checkout/start/route.ts:52`
- **Dangerous sink:** `packages/shop/app/api/checkout/start/route.ts:107`

## Validation rubric

- [x] Prove that a remote customer controls `price` and `qty` at the real HTTP entrypoint.
- [x] Prove those fields determine the authenticated Arcora invoice amount without a server-side catalog lookup.
- [x] Identify validation gates and deployment preconditions.
- [x] Trace payment success into order-success and fulfillment semantics.
- [x] Identify counterevidence and calibrate impact for the current testnet deployment.

## Evidence

### 1. The catalog is authoritative only in the browser

All four products are defined server-side at `$9.99` in
`packages/shop/lib/products.ts:11-49`. Product pages pass those values into the
client cart in `packages/shop/components/AddToCartForm.tsx:18-27`.

The cart is then stored in browser `localStorage`, including `price` and `qty`,
at `packages/shop/lib/cart.tsx:34-42` and `packages/shop/lib/cart.tsx:52-64`.
The Zod schema only validates the browser copy as finite/nonnegative and
positive; it does not make it authoritative, and a caller can bypass the UI
entirely.

At checkout, the browser serializes the complete cart to the public route:

```text
packages/shop/app/checkout/page.tsx:45-49
POST /api/checkout/start
body: JSON.stringify({ items, address, payIn })
```

There is no shop middleware, login requirement, CSRF check, per-customer
authorization, or server-side cart identifier.

### 2. The route trusts the submitted amount inputs

`packages/shop/app/api/checkout/start/route.ts:34-49` only checks that `items`
is a non-empty array, `payIn` is supported, and required address strings are
present. TypeScript interfaces do not validate runtime JSON.

The invoice amount is computed directly from attacker-controlled values:

```text
packages/shop/app/api/checkout/start/route.ts:52-59
subtotal = sum(item.price * item.qty)
amountUsdc = round(subtotal, cents)
```

The route never imports `PRODUCTS`, looks up `sku`, verifies `name`, enforces a
server-side quantity bound, validates size, or recomputes price from the
catalog.

It forwards that amount to Arcora with the shop's server-only API key at
`packages/shop/app/api/checkout/start/route.ts:105-119`. The same untrusted
`sku`, `name`, and `qty` are encoded into order metadata at lines 80-101.

### 3. Realistic HTTP reproduction

A local instance of the unmodified shop route was configured with a mock
upstream, so the request crossed the actual Next.js HTTP boundary but could not
create a real invoice.

Submitted cart:

```json
{
  "items": [
    {
      "sku": "tee",
      "name": "Arcora Tee",
      "price": 0.001,
      "qty": 10,
      "size": "M"
    }
  ],
  "address": {
    "email": "validation@example.test",
    "fullName": "Validation User",
    "line1": "1 Test Street",
    "city": "Testville",
    "postalCode": "00000",
    "country": "United States"
  },
  "payIn": "USDC"
}
```

Observed authenticated upstream request:

```json
{
  "amountUsdc": 0.01,
  "payInToken": "USDC",
  "metadata": {
    "source": "arcora-shop",
    "items_summary": "10x Arcora Tee (M)",
    "items_json": "[{\"sku\":\"tee\",\"name\":\"Arcora Tee\",\"qty\":10,\"size\":\"M\",\"lineTotal\":0.01}]"
  }
}
```

The upstream request included the configured `X-Arcora-Api-Key`. The route
returned HTTP 200 with the mock invoice URL. The canonical catalog price for
the same ten tees is `$99.90`; the created invoice request was `$0.01`.

As a safe deployment check, `https://arcora-shop.vercel.app/` returned HTTP
200 and the public `/api/checkout/start` route returned `400 cart_empty` for an
empty-cart negative control on 2026-06-06. No crafted non-empty request was
sent to production because invoice creation spends the server wallet's gas.

### 4. Arcora treats the manipulated amount as authoritative

The Arcora invoice API authenticates the shop's key and validates only a
numeric range of `0.000001` through `1,000,000` at
`packages/app/app/api/invoices/route.ts:46-60` and
`packages/app/app/api/invoices/route.ts:86-110`.

It converts the submitted amount directly to six-decimal base units at
`packages/app/app/api/invoices/route.ts:240`, creates the on-chain invoice at
lines 243-252, and stores the same amount and metadata at lines 260-273. It has
no access to the shop catalog and therefore cannot detect the discount.

The shop rounds to cents, so the practical minimum through this route is
`$0.01`, not one micro-USDC. Negative, zero, `NaN`, and out-of-range totals are
rejected downstream or fail JSON serialization, but any attacker-selected
positive cent amount is accepted.

### 5. Paid and success semantics

Payment uses the stored invoice `amountOut`, not a later catalog check:

- `packages/app/app/i/[invoiceId]/page.tsx:73-81` passes stored `amountOut` to checkout.
- `packages/app/app/i/[invoiceId]/CheckoutClient.tsx:62-85` quotes and pays that amount.
- `ops/indexer/run.ts:218-250` treats an on-chain `InvoicePaid` event as
  authoritative, changes the database status to `paid`, and queues
  `invoice.paid`.
- `packages/app/app/i/[invoiceId]/CheckoutClient.tsx:42-55` renders success
  and redirects to the shop only after the invoice is paid.
- `packages/shop/app/success/page.tsx:25-44` clears the local cart and displays
  "Order received."

Consequently, an attacker who pays the manipulated invoice obtains the same
paid status and shop success flow as a normally priced customer.

## Fulfillment semantics and counterevidence

The storefront advertises a live storefront, worldwide shipping, and "Real
fulfillment" in `packages/shop/app/page.tsx:9-16`,
`packages/shop/app/page.tsx:29-30`, and
`packages/shop/app/p/[slug]/page.tsx:60-63`. Shipping and item details are
stored as invoice metadata.

However, the repository does **not** implement inventory reservation, an order
database, shipment creation, email confirmation, or automatic fulfillment.
The evidence supports manual operator fulfillment only:

- The shop's original design states the invoice is the order source of truth.
- The authenticated invoice GET can return metadata at
  `packages/app/app/api/invoices/[id]/route.ts:79-86`.
- The current merchant dashboard response and table omit metadata at
  `packages/app/app/api/merchant/route.ts:30-38` and
  `packages/app/components/merchant/InvoiceTable.tsx:15-24`.
- Despite documentation showing metadata, the actual paid webhook payload at
  `ops/indexer/run.ts:82-104` and `ops/indexer/run.ts:249-250` contains only
  event/invoice/transaction fields plus `paid_by`.

This weakens automatic exploitation: an operator must separately retrieve and
trust the metadata, and the manipulated `lineTotal` plus unusually low invoice
amount can reveal the fraud during manual review. There is no repository
evidence that an order was or would be shipped automatically.

The deployment is also explicitly pre-revenue and Arc-testnet-only
(`README.md:14-29`, `docs/PITCH.md:193-199`). Testnet USDC/EURC has no intended
real monetary value. This substantially lowers present direct payment-loss
impact, although physical inventory loss remains possible if operators ship
merchandise based only on paid status and attacker-controlled metadata.

## Exploitability

**Confirmed at invoice creation. Conditional at physical fulfillment.**

Required conditions:

1. The public shop route is deployed with a valid `ARCORA_API_KEY`.
2. The Arcora merchant has allowed shop redirect origins and can create
   invoices on the active gateway.
3. The attacker sends a direct HTTP request or tampers with browser cart data.
4. For a paid-order outcome, the attacker has enough supported tokens to pay
   the attacker-selected amount and settlement succeeds before expiry.
5. For physical loss, an operator fulfills from paid status/metadata without
   independently checking catalog price and quantity.

No authentication, API-key knowledge, privileged browser state, or race is
required from the attacker.

## Impact

- Creates a genuine Arcora invoice under the shop merchant for an
  attacker-selected positive cent amount.
- Allows paid invoice and success semantics for merchandise metadata whose
  expected catalog total is much higher.
- Allows independent spoofing of SKU, product name, size, and quantity.
- Can corrupt order/accounting data and consume the shared invoice-creation
  rate limit and server-wallet gas even if the invoice is never paid; this is a
  related consequence of the same unauthenticated entrypoint, not the primary
  AFG-003 claim.
- Can cause physical inventory and shipping loss if manual fulfillment trusts
  the paid invoice and metadata.

## Severity rationale

**Medium** is appropriate for the code path because an unauthenticated remote
caller can cross a server-held merchant credential boundary and create a
payable invoice that is indistinguishable in lifecycle status from a legitimate
order while asserting real merchandise quantities.

The current live impact is constrained by testnet/pre-revenue operation,
manual-only fulfillment, visible amount inconsistencies, and the absence of
proof that operators ship without review. Those constraints prevent a High
rating for the present deployment. The same implementation should be treated
as High before mainnet or automated fulfillment because it would permit direct,
repeatable underpayment for goods.

## Minimal remediation direction

Treat the request as product selections, not prices:

1. Accept only `sku`, `qty`, and valid option identifiers.
2. Validate quantity as an integer within a server-side bound.
3. Look up each SKU and option in the server-owned catalog.
4. Recompute names, unit prices, line totals, and invoice total exclusively
   from server data.
5. Persist a server-side order record and fulfill only from that record after
   verified payment, rather than from client-authored invoice metadata.

## Validation closure

| Ledger row ID | Instance key | Root control | Entrypoint/source | Sink/control | Disposition | Counterevidence or proof gap | Survives |
|---|---|---|---|---|---|---|---|
| unavailable | `shop-checkout-client-price-and-qty-trust` | `packages/shop/app/api/checkout/start/route.ts:52` | `packages/shop/app/checkout/page.tsx:45` and public direct HTTP | Authenticated `POST /api/invoices` at `packages/shop/app/api/checkout/start/route.ts:107` | reportable | Testnet/pre-revenue; no automated fulfillment; manual review can detect amount mismatch; actual shipment behavior is outside the repository | yes |

