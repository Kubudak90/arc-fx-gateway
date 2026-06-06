# AFG-019 Validation: Browser SDK exposes the merchant secret API key

## Disposition

| Field | Assessment |
|---|---|
| Candidate | AFG-019 |
| Instance key | Browser SDK / merchant API-key trust-boundary confusion |
| Ledger row id | Not provided in the available artifact tree |
| Disposition | **reportable** |
| Survives validation | **yes** |
| Confidence | **high** |
| Severity | **high** |
| Validation method | Focused static source-to-sink trace plus existing targeted test execution |

The finding is valid. Arcora's browser, CDN, and React integration guidance places a merchant `apiKey` in public client code. That value is not a separately scoped publishable key: it is the same one-time-reveal `ak_live_` bearer credential stored in `merchants.api_key_hash` and accepted by privileged server routes.

An attacker who visits an adopting merchant site can recover the key from the JavaScript bundle, HTML, component props, environment-inlined values, or the browser network request. The attacker can then create invoices under the merchant identity, causing server-paid on-chain `createInvoiceFor` transactions, and can read merchant escrow data and authenticated invoice details.

## Validation rubric

- [x] Browser-facing documentation or APIs instruct merchants to expose a key in public client code.
- [x] The exposed value is the same credential accepted by privileged server routes.
- [x] No publishable-key type, scope, or server-side capability boundary separates browser checkout from merchant operations.
- [x] CORS and origin controls do not prevent replay of the recovered bearer credential.
- [x] A concrete abuse path reaches integrity, confidentiality, and operational-cost impact.

## Evidence

### 1. Browser integrations explicitly receive the merchant API key

- `packages/sdk/README.md:15-35` documents a static `<script>` integration with `Arcora.init({ apiKey: "ak_live_..." })`.
- `packages/sdk/README.md:53-80` embeds `ak_live_...` directly in React component and hook examples.
- `packages/sdk/examples/cdn-button.html:69-75` tells the integrator to use the merchant API key provisioned in the dashboard and stores it in page JavaScript. It even accepts the key from an `apikey` URL query parameter.
- `packages/sdk-react/README.md:15-69` passes the same `apiKey` through `<CheckoutButton>` and `useCheckout`.
- `packages/app/app/docs/sdk/page.tsx:81-117` recommends `process.env.NEXT_PUBLIC_ARCORA_KEY`, which is compiled into browser-delivered JavaScript.
- `docs/LITEPAPER.md:249-261` calls the React value `publicKey`, but no corresponding public-key credential exists in the implementation.

The React wrapper constructs the ordinary SDK client from that value (`packages/sdk-react/src/useCheckout.ts:12-20`), and the SDK sends it as `X-Arcora-Api-Key` to both invoice creation and escrow listing (`packages/sdk/src/client.ts:32-59`, `79-104`).

### 2. The server implements only one merchant API-key class

- `packages/app/lib/auth/apikey.ts:7-35` generates only `ak_live_` keys and performs one lookup against `merchants.apiKeyHash`.
- `packages/app/lib/db/schema.ts:23-35` contains one API-key hash and prefix per merchant; there is no key type, scope, audience, origin binding, or publishable-key column.
- `packages/app/app/api/merchant/bootstrap/route.ts:74-95` generates this key, stores its hash, and returns the raw key alongside the webhook secret.
- `packages/app/app/api/merchant/api-key/route.ts:8-21` rotates the same credential and returns it once.
- `packages/app/components/merchant/ApiKeyCard.tsx:72-86` treats the key as a one-time-reveal credential that must be saved, consistent with secret-key behavior rather than a safe public identifier.

The `publicKey` and `NEXT_PUBLIC_ARCORA_KEY` wording is therefore documentation-level intent only. It does not map to a restricted credential.

### 3. The recovered key authorizes privileged capabilities

**Invoice creation and server-wallet spending**

`packages/app/app/api/invoices/route.ts:86-100` authenticates solely with the recovered API key. A successful request calls the server wallet's on-chain `createInvoiceFor` and waits for its receipt (`route.ts:233-273`). The route itself records that every call costs server-wallet gas and RPC quota and that a stolen key can drain those resources (`route.ts:15-27`).

The per-merchant limit is 60 invoice creations per 60 seconds (`route.ts:29-30`, `92-105`). Limiter errors fail open. This bounds normal sustained abuse but does not make public exposure safe.

**Merchant escrow disclosure**

`packages/app/app/api/merchant/escrows/route.ts:21-36`, `62-79` deliberately accepts the same API key and returns the merchant's pending, matured, and claimed escrow rows. Returned fields include invoice id, amount, payout token, claimability, and status (`packages/sdk/src/types.ts:11-17`).

**Authenticated invoice-detail disclosure**

`packages/app/app/api/invoices/[id]/route.ts:44-63`, `79-86` accepts the same key and upgrades the response to include merchant metadata, payer address, payment transaction, and paid timestamp for an invoice owned by that merchant.

No API-key-authenticated refund, payout mutation, webhook mutation, key rotation, or origin mutation route was found. Those operations remain session- or on-chain-authorized.

### 4. CORS does not mitigate the credential replay

`POST /api/invoices` is intentionally browser callable:

- `packages/app/app/api/invoices/route.ts:69-84` returns `Access-Control-Allow-Origin: *`.
- Its preflight explicitly permits `POST` and the `x-arcora-api-key` header.
- `packages/app/app/docs/quickstart/page.tsx:97-101` states that the endpoint is CORS-open by design.

The escrow and invoice-detail routes do not add equivalent permissive CORS headers, which can prevent an unrelated browser origin from reading their responses. That is counterevidence for a pure cross-origin-browser attack, but it is not an authorization boundary: after extracting the bearer key, an attacker can call those routes from a server, CLI, extension, proxy, or same-origin script. CORS also does not stop `POST /api/invoices`, because that route explicitly allows arbitrary origins.

The merchant `allowedOrigins` field controls post-payment redirect destinations, not which origins may use the API key.

## Exploit path

1. A merchant follows the CDN or React documentation and deploys its dashboard-issued `ak_live_` key in public client code.
2. An unauthenticated attacker visits the storefront and extracts the key from HTML/JavaScript, React props, a `NEXT_PUBLIC_` bundle value, or the outgoing `X-Arcora-Api-Key` request.
3. The attacker sends:

   ```http
   POST /api/invoices
   X-Arcora-Api-Key: <recovered key>
   Content-Type: application/json

   {"amountUsdc":1,"payInToken":"USDC","metadata":{"source":"attacker"}}
   ```

   Omitting `successUrl` and `cancelUrl` avoids the redirect-origin checks because the server schema makes both optional.
4. For each accepted request, Arcora submits and pays for an on-chain `createInvoiceFor` transaction under the victim merchant and inserts an invoice row.
5. The attacker can repeat up to the normal 60-per-minute merchant limit, and can separately use the same key to enumerate escrow buckets.
6. When an invoice id is known, the same key returns authenticated fields including metadata and payer/payment information.

No victim interaction is required after the merchant has deployed the documented browser integration.

## Impact

- **Integrity:** unauthorized invoices are created under the victim merchant identity and persisted both on-chain and in Arcora's database.
- **Availability/cost:** repeated calls consume the shared server wallet's gas and RPC quota and create persistent chain/database noise. The code explicitly identifies stolen-key looping as a resource-drain threat.
- **Confidentiality:** the key exposes merchant escrow inventory and, for known invoice ids, metadata, payer address, transaction hash, and payment timestamp.
- **Merchant operations:** fake invoices can pollute reconciliation, webhook/order workflows, analytics, and support investigations.

The attacker cannot use the proven path to redirect payout funds to itself. Created invoices retain the real merchant identity and payout configuration.

## Intended publishable behavior versus secret-key behavior

A browser SDK may legitimately use a publishable credential when that credential is intentionally non-secret and limited to a narrow operation such as creating a client checkout session from server-approved price or product data. That model requires a separate key namespace and server-enforced capabilities, commonly including origin binding, restricted endpoint access, and restrictions on attacker-selected amount and metadata.

Arcora currently has the opposite shape:

- The dashboard presents the value once and rotates it like a secret.
- The threat model says API-key leakage is the primary off-chain risk (`docs/audit/threat-model.md:92-101`).
- The same value authorizes server-paid writes and merchant data reads.
- There is no publishable/secret key distinction in storage, authentication, or route authorization.

The documented browser usage is therefore not harmless intended publishable-key behavior; it exposes a secret credential whose server capabilities exceed a browser checkout token.

## Counterevidence and limiting controls

- Redirect URLs must match merchant-configured origins and pass public-URL checks (`packages/app/app/api/invoices/route.ts:112-152`). This blocks arbitrary attacker-controlled success/cancel redirects.
- Invoice creation is normally limited to 60 requests per merchant per minute.
- Amounts are bounded and input metadata is capped.
- Compliance checks and on-chain delegate authorization still apply.
- Fake invoices settle to the configured merchant, not to an attacker-controlled payout address.
- API-key rotation immediately invalidates the exposed key.
- Session-only merchant routes prevent the key from rotating credentials or changing merchant settings.
- There is no separate Arc mainnet deployment in the SDK defaults today (`packages/sdk/src/client.ts:4-17`), which tempers immediate production-funds impact but does not remove the credential-design flaw.

These controls reduce direct theft and unbounded abuse. They do not defeat the finding because the key remains publicly recoverable and still authorizes privileged operations.

## Severity rationale

**High.** Exploitation is remote, unauthenticated, low-complexity, and expected to affect every merchant that follows the browser/CDN/React documentation. The recovered key permits authenticated server-paid writes and merchant-data reads. Direct payout theft is blocked, and rate limiting bounds normal invoice spam, so this is not critical.

If severity is scored only against the current testnet-only deployment, medium may be used as a temporary environmental adjustment. The code and published integration contract should remain high priority before any production/mainnet use.

## Tests executed

The repository was not modified except for this report.

- `packages/sdk`: `vitest run test/client.test.ts` — 10/10 passed.
- `packages/sdk-react`: `vitest run test/useCheckout.test.tsx` — 6/6 passed.
- `packages/app`: invoice creation, invoice detail, and merchant escrow route suites — 25/25 passed.

The passing tests confirm that the SDK forwards the supplied API key, valid API-key authentication reaches `createInvoiceFor`, API-key auth returns escrow data, and matching merchant API-key auth returns the private invoice shape.

## Remaining uncertainty

- No real merchant key was extracted or replayed against a deployed environment; validation used repository code and targeted executable tests to avoid touching live merchant data or spending server-wallet gas.
- The available scan artifact tree did not contain a candidate ledger row, discovery receipt, or seed anchor for AFG-019. The source anchors above reconstruct the complete candidate instance.

## Recommended remediation direction

Create a distinct publishable credential with a separate prefix, hash/storage record, explicit capabilities, and origin restrictions. It should not authorize escrow listing or private invoice fields. Browser invoice creation should use server-defined products/prices or a short-lived checkout-session token minted by the merchant's backend; the existing `ak_live_` key should be documented and enforced as server-side secret material only.

## Validation closure

| Ledger row id | Instance key | Source reference | Root control | Entrypoint/source | Sink/control | Disposition | Counterevidence or proof gap | Survives |
|---|---|---|---|---|---|---|---|---|
| not provided | Browser SDK / merchant API-key trust-boundary confusion | `packages/app/app/docs/sdk/page.tsx:81-117` | `packages/app/lib/auth/apikey.ts:7-35` | CDN, React, and browser SDK integrations expose `apiKey` | Same bearer key authorizes `/api/invoices`, `/api/merchant/escrows`, and private invoice fields | reportable | Origin allowlist blocks arbitrary redirects; rate limit bounds normal spam; no direct payout mutation; no live-key replay performed | yes |
