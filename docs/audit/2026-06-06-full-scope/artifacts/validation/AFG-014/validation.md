# AFG-014 Validation

## Disposition

**Suppressed (not reportable as currently claimed).**

- **Confidence:** High
- **Validated severity:** Informational / None
- **Candidate severity if the unreachable `lineItems` shape became writable:** Medium
- **Validation method:** Focused static source-to-sink trace, creation-path review, git-history review, and targeted existing tests
- **Commit validated:** `03db7f171cfa67056026a59b7995b3ae8e7f6874`
- **Instance key / ledger row:** Not provided

The public hosted checkout does bypass the anonymous invoice API and query
`invoices.metadata` directly. However, the only metadata it renders is a nested
`metadata.lineItems` array, while every supported invoice creation interface
accepts only `Record<string, string>`. The production shop's real order and
shipping PII is stored in flat string fields and is not rendered by
`InvoiceCard`. No first-party path was found that can persist the nested shape
required to reach the suspected sink.

## Validation Rubric

- [x] Confirm whether `/i/{invoiceId}` is anonymously reachable.
- [x] Trace metadata from the database query to every rendered field.
- [x] Determine whether supported creation paths can populate the rendered shape.
- [x] Assess invoice identifier entropy and practical discoverability.
- [x] Identify realistic confidentiality impact and counterevidence.

## Claimed Tuple

- **Attacker input:** An invoice ID obtained from a checkout link or public chain data.
- **Entrypoint:** `GET /i/{invoiceId}`.
- **Source:** `invoices.metadata`.
- **Sink:** Line-item text rendered by `InvoiceCard`.
- **Required precondition:** The database row must contain a non-empty
  `metadata.lineItems` array.
- **Claimed impact:** Anonymous disclosure of merchant order details or customer
  PII.

## Evidence

### 1. The hosted checkout is public and reads metadata directly

`packages/app/app/i/[invoiceId]/page.tsx:8-35` performs a direct database lookup
using the URL invoice ID. It selects `invoices.metadata` at line 22 and passes it
to `InvoiceCard` at lines 59-68. There is no session, API-key, or ownership check.
`packages/app/middleware.ts:5-23` only applies special handling to the docs host
and `/m/` routes; it does not protect `/i/`.

This confirms the architectural mismatch with
`packages/app/app/api/invoices/[id]/route.ts:65-76`, where anonymous API callers
receive a deliberately reduced response with metadata omitted.

### 2. Exact metadata fields conditionally exposed

`packages/app/components/checkout/InvoiceCard.tsx:37-43` ignores all metadata
unless `metadata.lineItems` is a non-empty array. For each array entry, lines
85-107 render only:

- `name`
- `description`
- `sku`
- `quantity` (only alongside `sku`)
- `amount`

Arbitrary metadata keys are not dumped or serialized into `InvoiceCard`.
Therefore `orderId`, `order_ref`, `items_json`, `shipping_email`,
`shipping_name`, address fields, and other flat metadata values are not exposed
through this component.

The page separately exposes checkout data required by the payment flow:
formatted amount, pay-in token symbol, status, expiry, invoice ID, and merchant
address. It also passes `successUrl`, `cancelUrl`, and allowed origins to the
client component (`page.tsx:73-82`), so those URLs reach the browser and may
contain merchant-chosen order references. That is adjacent behavior, not
metadata or line-item disclosure.

### 3. Supported creation paths cannot create `metadata.lineItems`

The sole first-party database insertion is
`packages/app/app/api/invoices/route.ts:260-273`. Its request schema at lines
46-60 requires every metadata value to be a string:

```text
metadata: z.record(z.string().max(256))
```

A nested array is rejected before insertion. The SDK contract agrees:
`packages/sdk/src/types.ts:19-25` and `packages/sdk/README.md:93-102` define
metadata as `Record<string, string>`.

The production shop demonstrates the highest-confidentiality real payload.
`packages/shop/app/api/checkout/start/route.ts:75-103` deliberately flattens
cart and shipping information into string fields:

- `order_ref`
- `items_summary`
- `items_json`
- `shipping_email`
- `shipping_name`
- `shipping_line1` / `shipping_line2`
- `shipping_city`
- `shipping_postal`
- `shipping_country`

None matches the `lineItems` array sink. Repository-wide search found no other
`db.insert(invoices)` call and no first-party producer of `metadata.lineItems`.
Git history shows the invoice API has required string-valued metadata since its
initial implementation; no legacy supported nested-metadata path was found.

### 4. URL entropy is strong but not a confidentiality control

`packages/app/app/api/invoices/route.ts:233-239` generates a random 256-bit
merchant invoice ID and derives the global ID with `keccak256`, so blind URL
brute force is infeasible.

Nevertheless, `packages/contracts/src/ArcFXGateway.sol:166-174,211-223` emits
the same `globalId` in the public `InvoiceCreated` event. An observer can
enumerate valid hosted-checkout IDs from chain logs. Any field rendered by the
page must therefore be considered public; URL entropy does not protect it.

This increases the hypothetical impact if nested `lineItems` ever becomes
writable, but it does not establish current reachability.

## Tests Performed

Targeted tests:

```text
./node_modules/.bin/vitest run \
  app/api/invoices/[id]/route.test.ts \
  app/api/invoices/route.test.ts
```

Result: **2 test files passed, 19 tests passed**.

The tests confirm that anonymous invoice API responses omit metadata and that
valid string metadata is accepted. An exact local evaluation of the production
Zod metadata expression accepted `orderId` and the shop's flat string shape,
but rejected a `lineItems` array with:

```text
metadata.lineItems Expected string, received array
```

## Counterevidence and Residual Risk

- The public page does query a broader row than the anonymous API and contains a
  real line-item rendering sink.
- PostgreSQL `jsonb` itself does not enforce the API schema. A manual database
  write, migration, compromised internal process, or future creation endpoint
  could insert `metadata.lineItems`; those values would then be disclosed.
- Invoice IDs are publicly enumerable from chain events, so a future relaxation
  of the metadata schema would immediately make this reportable.
- Redirect URLs reach the anonymous browser and may expose merchant-chosen order
  identifiers. This is separate from the candidate's metadata claim and was not
  shown to expose the shop's stored shipping PII.

## Remaining Uncertainty

No live production database was inspected. The repository provides no evidence
of historical or manually inserted rows containing `metadata.lineItems`.
Production-only out-of-band writers could change that conclusion, but none are
present in scope.

## Minimal Follow-up

No security fix is required for AFG-014 as currently reachable. As
defense-in-depth, remove metadata from the public page query or replace the
unreachable `lineItems` convention with an explicitly public, creation-time
validated invoice-display field. Add a regression test ensuring PII-bearing flat
metadata never appears in hosted-checkout output.

## Validation Closure

| Ledger row | Instance key | Root control | Entrypoint | Sink/control | Disposition | Counterevidence / proof gap | Survives |
|---|---|---|---|---|---|---|---|
| Not provided | AFG-014 | `packages/app/app/api/invoices/route.ts:46-60` | `packages/app/app/i/[invoiceId]/page.tsx:8-35` | `InvoiceCard.tsx:37-43,82-109` | suppressed | Required nested array is rejected by every supported creation path; production PII uses ignored flat strings. Production DB contents were not inspected. | no |
