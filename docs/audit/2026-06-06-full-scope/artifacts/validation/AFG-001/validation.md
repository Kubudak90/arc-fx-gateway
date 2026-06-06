# AFG-001 Validation: Webhook DNS-Rebinding TOCTOU

**Disposition:** Reportable  
**Confidence:** High (0.90)  
**Recommended severity:** Medium  
**Root control:** `ops/webhooks/run.ts:164-180`  
**Sink:** `ops/webhooks/run.ts:203-214`  
**Instance key:** `ops/webhooks/run.ts:172->203:dns-rebinding`

## Validation Rubric

- [x] An attacker can supply the hostname later stored in `row.url`.
- [x] Validation and connection use separate DNS resolutions.
- [x] The connection-time address is not pinned or rechecked.
- [x] A bounded PoC reaches a changed private address through the fetch sink.
- [x] Preconditions and production HTTPS countercontrols are reflected in severity.

## Static Trace

1. An authenticated merchant controls `webhookUrl` through bootstrap or settings (`packages/app/app/api/merchant/bootstrap/route.ts:17-20,51-59,79-83`; `packages/app/app/api/merchant/webhook/route.ts:12-36`). The settings route also requires same-origin and a merchant session.
2. Event producers copy that value into `webhook_attempts.url`, including `ops/indexer/run.ts:82-104` and `packages/app/app/api/checkout/authorize/route.ts:280-309`.
3. The worker loads the stored URL at `ops/webhooks/run.ts:64-79`.
4. `assertSafeAtDelivery()` resolves the hostname with `dns.lookup(..., { all: true })` and rejects private answers at `ops/webhooks/run.ts:153-180`.
5. After that check completes, `deliver()` passes the original hostname to a separate global `fetch(row.url)` at `ops/webhooks/run.ts:182-214`. No custom Undici dispatcher, connection lookup hook, or validated-IP pinning binds the checked address to the socket.
6. Redirects are correctly disabled, but that does not address a changed answer during the initial connection.

Node's documented global `fetch` is Undici-based and supports a custom dispatcher. This call supplies none, so the earlier application-level lookup does not constrain connection establishment.

## Bounded PoC

A loopback-only harness on Node `v24.12.0` / Undici `7.16.0` returned `93.184.216.34` to the safety lookup and `127.0.0.1` to the lookup used by `fetch`. The internal listener received the POST and returned 204:

```text
{"safetyLookup":[{"address":"93.184.216.34","family":4}]}
{"internalServerReached":true,"method":"POST","host":"afg001-rebind.invalid:49662","body":"{\"type\":\"invoice.paid\"}"}
{"fetchStatus":204,"safetyLookups":1,"fetchLookups":1}
```

Artifacts: `validation_artifacts/poc.cjs`, `validation_artifacts/bounded-poc.log`, and `validation_artifacts/README.md`.

## Exploitability And Impact

**Attacker input/control:** A low-privilege authenticated merchant controls the webhook scheme, hostname, port, path, and query, and can control the hostname's authoritative DNS answers. The POST body and Arcora headers are service-generated.

**Preconditions:** The attacker must register a webhook, cause an event to be queued, and make the validation lookup return only public addresses while the connection lookup returns an internal address. The target must accept the resulting POST or expose a useful response/status behavior.

**Realistic impact:** Blind SSRF from the webhook VPS into loopback, RFC1918, link-local, or otherwise worker-reachable services. This can invoke unauthenticated internal POST endpoints, probe reachability through delivery/retry behavior, or affect internal services. The checked-in systemd unit runs without a dedicated `User=` or service sandbox (`ops/webhooks/arcora-webhooks.service:8-21`), increasing the worker's local/network blast radius.

## Counterevidence And Limits

- Validation occurs immediately before fetch, so exploitation depends on two closely spaced DNS answers and resolver/cache behavior.
- Direct private answers and mixed public/private answer sets are rejected; redirects are not followed.
- When `NODE_ENV` is exactly `production`, only HTTPS URLs are accepted (`ops/webhooks/run.ts:169-170`). Normal TLS hostname verification blocks most rebinding attempts to arbitrary internal HTTPS services unless the target presents a certificate valid for the attacker-controlled hostname.
- The systemd unit does not itself set `NODE_ENV`, and no checked-in webhook env template proves the HTTPS branch is active. If it is absent, HTTP remains accepted in the deployed daemon.
- The primitive is blind: response bodies are discarded and webhook-attempt status is not exposed through a merchant API found in the scoped trace.

## Severity Rationale

**Medium** is recommended because the source/control/sink chain and connection-time bypass are reproduced, attacker setup is available to ordinary authenticated merchants, and an HTTP-capable worker can reach sensitive internal services. Complexity, blind output, fixed POST shape, and HTTPS/TLS constraints prevent a High rating.

If deployment evidence proves `NODE_ENV=production`, strict TLS verification, and no internal HTTPS endpoint can present a certificate valid for merchant-controlled names, operational severity can be reduced to **Low** while retaining the reportable design flaw.

## Remediation

Resolve once, reject every unsafe result, and make the HTTP client's connection lookup return only a selected validated address while preserving the original hostname for Host/SNI and TLS identity verification. Apply the same policy to every new connection and keep redirects disabled. Also fail startup unless the deployment mode is explicit, and set `NODE_ENV=production` in the systemd environment.

## Closure

| Ledger row | Instance key | Entrypoint/source | Sink/control | Disposition | Counterevidence or proof gap | Survives |
|---|---|---|---|---|---|---|
| AFG-001 | `ops/webhooks/run.ts:172->203:dns-rebinding` | Authenticated merchant `webhookUrl` | Separate `dns.lookup` then global `fetch` | reportable | HTTPS/TLS narrows targets; deployed `NODE_ENV` unproven | yes |
