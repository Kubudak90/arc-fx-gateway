# AFG-010 Validation

## Disposition

**Reportable - High severity, high confidence (0.88).**

The relayer can operate with unauthenticated PostgreSQL TLS and accepts the
`invoices.gateway_address` value returned by PostgreSQL as the ERC-20 spender
and `settleInvoice` call target. When certificate verification is effectively
disabled, a network-positioned database MITM can replace that result with an
attacker-controlled address. After Permit2 and the swap place the payout token
in the relayer wallet, the relayer approves the attacker-selected address for
the exact gross payout. An attacker EOA can later spend that allowance, or an
attacker contract can consume it during a fake `settleInvoice` call.

This is conditional on the effective PostgreSQL client configuration. With the
installed `pg@8.20.0`, an `sslmode=require` or `sslmode=verify-full` query
parameter in `POSTGRES_URL_NON_POOLING` replaces the explicit
`ssl: { rejectUnauthorized: false }` object and enables certificate
verification. The repository does not require such a parameter, and current
Supabase direct-connection examples use a bare port-5432 URL without
`sslmode`; for that documented deployment shape, the insecure explicit object
remains effective.

## Candidate Metadata

- Candidate: `AFG-010`
- Instance key: not provided
- Ledger row id: not provided
- Root controls:
  - `ops/relayer/run.ts:108` - PostgreSQL pool TLS configuration
  - `ops/relayer/run.ts:149-151` - unvalidated per-row gateway selection
- Affected sinks:
  - `ops/relayer/run.ts:409-416` - payout-token approval
  - `ops/relayer/run.ts:418-433` - call to selected `settleInvoice` target
- Validation method: focused static trace, installed-runtime configuration
  check with `pg@8.20.0`, and current node-postgres/Supabase documentation

## Validation Rubric

- [x] Trace who creates the queue row and where `gateway_address` originates.
- [x] Determine when PostgreSQL server identity verification is actually off.
- [x] Check for address, allowlist, bytecode, or role validation before signing.
- [x] Trace the payout token from swap output through approval and settlement.
- [x] Establish a realistic DB-MITM-to-fund-loss path and identify constraints.

## Evidence

### 1. Database row provenance

The normal API path creates the invoice on the configured gateway, waits for
the transaction receipt, and writes that same `GATEWAY` value to
`invoices.gateway_address`:

- `packages/app/app/api/invoices/route.ts:154-156`
- `packages/app/app/api/invoices/route.ts:243-269`

The checkout submit route validates the invoice and Permit2 signature, then
copies payment fields into `relayer_queue`; it does not copy or authenticate a
gateway address:

- `packages/app/app/api/checkout/submit/route.ts:112-145`
- `packages/app/app/api/checkout/submit/route.ts:177-230`

The indexer can also backfill invoices. It derives `gateway_address` from
`log.address`, but only for logs fetched from its configured
`WATCHED_GATEWAYS` list:

- `ops/indexer/run.ts:16-26`
- `ops/indexer/run.ts:147-155`
- `ops/indexer/run.ts:189-210`

The relayer claims a queue row and joins `invoices.gateway_address` into the
result:

- `ops/relayer/run.ts:175-195`

The schema provides only a nullable text column. There is no database check
constraint binding it to a canonical address:

- `packages/app/lib/db/schema.ts:59-62`
- `packages/app/lib/db/migrations/0006_v9_gateway_address.sql:1`

Thus normal writers produce a trustworthy value, but the relayer treats the
database response itself as the trust anchor. A MITM need not persist a row
change; changing the returned PostgreSQL `DataRow` is sufficient.

### 2. TLS and configuration assumptions

`ops/relayer/run.ts:108` constructs:

```ts
new pg.Pool({
  connectionString: PG_URL,
  ssl: { rejectUnauthorized: false },
})
```

For a DSN without an SSL query parameter, the installed `pg@8.20.0` retains
`{ rejectUnauthorized: false }`. TLS encrypts the connection but accepts an
attacker certificate, so DNS, routing, host-network, upstream-network, or
similar path control can support a transparent PostgreSQL MITM.

There is material counterevidence for some deployments: node-postgres warns
that SSL settings in a connection string replace the separately supplied
`ssl` object. Local checks against the installed version produced:

| DSN setting | Effective `ssl` |
|---|---|
| no `sslmode` | `{ rejectUnauthorized: false }` |
| `sslmode=require` | `{}` |
| `sslmode=verify-full` | `{}` |
| `sslmode=no-verify` | `{ rejectUnauthorized: false }` |

Under current `pg@8.20.0` semantics, `{}` uses Node TLS defaults and verifies
the certificate and hostname. This defeats the MITM premise if the production
DSN includes `sslmode=require` or `verify-full` and no other trust override is
present.

The repository does not enforce that safe condition:

- `ops/relayer/.env.example:27-28` documents a bare PostgreSQL URL.
- `ops/vault/README.md:108-120` gives no certificate or `sslmode` requirement.
- `docs/audit/deploy-checklist.md:65-76` checks gateway wiring but not database
  TLS identity verification.
- The local `ops/relayer/.env` does not contain a usable production DSN, so the
  deployed VPS value could not be confirmed from this checkout.

Current Supabase documentation likewise shows direct port-5432 connection
strings without `sslmode`. Its SSL guidance recommends `verify-full` with the
downloaded Supabase CA, but that stronger setup is not implemented or required
by the relayer configuration.

### 3. Gateway validation

`gatewayFor` lowercases the database value and applies a TypeScript cast:

```ts
const addr = (row.gateway_address ?? GATEWAY).toLowerCase();
return addr as Address;
```

There is no runtime comparison to `GATEWAY`, deployment manifest allowlist,
`WATCHED_GATEWAYS`, expected code hash, `eth_getCode`, interface probe, or
role check. A malformed value may fail ABI encoding, but any valid attacker
address passes. The environment gateway is used only when the DB value is
`NULL`; it is not an integrity check.

The canonical gateway's `onlyRole(RELAYER_ROLE)` check at
`packages/contracts/src/ArcFXGateway.sol:260-276` is not protective after
redirection. It executes only when the canonical contract is called. An
attacker contract can expose the same selector without that check, and an EOA
accepts the transaction without executing canonical gateway code.

### 4. Approval and call path

The relayer first pulls customer pay-in to its own wallet through Permit2:

- `ops/relayer/run.ts:327-368`

It either keeps the same token or swaps into the invoice payout token:

- `ops/relayer/run.ts:651-688`

Immediately before settlement, the relayer:

1. Selects `targetGateway` from the joined DB value.
2. Calls `payoutToken.approve(targetGateway, grossPayoutBaseUnits)`.
3. Waits for the approval receipt.
4. Calls `targetGateway.settleInvoice(...)`.

Evidence: `ops/relayer/run.ts:391-434`.

The approval is exact rather than unlimited, which caps one exploitation to
the current row's gross payout. It is nevertheless sufficient to steal the
entire payout token balance attributable to that settlement.

### 5. Realistic attack path

Preconditions:

1. The deployed DSN leaves `rejectUnauthorized:false` effective, such as a bare
   direct Supabase URL without `sslmode`.
2. The attacker gains a network position capable of redirecting or proxying
   the VPS-to-PostgreSQL connection.
3. A pending row reaches the relayer and Permit2/swap succeeds.

Attack:

1. The attacker presents any TLS certificate; the relayer accepts it.
2. The attacker proxies PostgreSQL authentication and traffic to the real
   database, preserving an apparently normal session.
3. On the claim query, the attacker changes only the returned
   `gateway_address` to an attacker EOA or contract.
4. Permit2 and App Kit execute normally, placing `grossPayout` of USDC/EURC in
   the relayer wallet.
5. The relayer approves the attacker address for `grossPayout`.
6. An attacker contract's fake `settleInvoice` calls
   `payoutToken.transferFrom(relayer, attacker, grossPayout)`, or an attacker
   EOA spends the allowance after the relayer's calldata-bearing transaction
   succeeds.
7. The relayer can mark the queue row settled even though the canonical
   gateway invoice remains `Created`; the customer pay-in/payout value is lost
   from the relayer wallet.

The attacker can repeat this per intercepted row. They do not need the relayer
private key, database password, gateway role, or write access to the real
database.

## Counterevidence and Limits

- A production DSN containing `sslmode=require` or `sslmode=verify-full`
  defeats the certificate-bypass premise under the installed `pg@8.20.0`.
- The current deployed VPS DSN was not available in this checkout, so the
  report does not claim that the live connection is presently exploitable.
- The attacker needs network/DNS/routing influence; this is not reachable by an
  ordinary checkout user solely through HTTP inputs.
- Approval is limited to one row's `grossPayout`, not the wallet's unlimited
  token balance. Persistent interception permits repeated per-row theft.
- The payout-token symbol allowlist limits the ordinary swap path to USDC/EURC,
  but it does not protect those tokens from an attacker-selected spender.
- Normal API and indexer writers pin the expected gateway. This protects
  against ordinary user-supplied row creation, not against an unauthenticated
  database transport.
- No live MITM or on-chain theft transaction was executed. The fund-loss step
  follows directly from standard ERC-20 allowance semantics and the observed
  approval/call sequence.

## Severity

**High.** Exploitation requires a privileged network position and an insecure
effective DSN, which lowers likelihood. Impact is direct and complete loss of
the relayer-held payout for each intercepted settlement, with potential
customer loss, false off-chain settlement state, and repeated theft while the
MITM persists. The canonical gateway's escrow and role invariants do not bound
funds deliberately approved to the redirected address.

## Remaining Uncertainty

The only material proof gap is the exact deployed
`POSTGRES_URL_NON_POOLING`. Confirming its sanitized host, `sslmode`, CA, and
effective `pg` SSL object would establish whether the live VPS is currently
exposed or whether this is a dangerous supported configuration.

## Minimal Next Step

On the VPS, print only the DSN host and SSL parameters, then instantiate
`pg`'s `ConnectionParameters` with the daemon's real configuration and inspect
the effective `ssl` object without printing credentials. If it is
`{ rejectUnauthorized: false }`, the live exposure is confirmed.

## Validation Closure

| Ledger row id | Instance key | Root control | Entrypoint/source | Sink/control | Disposition | Counterevidence or proof gap | Survives |
|---|---|---|---|---|---|---|---|
| not provided | not provided | `ops/relayer/run.ts:108`, `:149-151` | PostgreSQL claim result joined from `invoices.gateway_address` | ERC-20 `approve` and selected-target `settleInvoice` at `:409-433` | reportable | Safe if deployed DSN makes `sslmode=require/verify-full` effective; live VPS DSN unavailable | yes |

## Validation Receipt

- Candidate: `AFG-010`
- Method: static source/control/sink trace; installed `pg@8.20.0`
  configuration evaluation; current node-postgres and Supabase documentation
- Disposition: `reportable`
- Confidence: `0.88`
- Severity: `high`
- Report: `docs/audit/2026-06-06-full-scope/artifacts/validation/AFG-010/validation.md`
