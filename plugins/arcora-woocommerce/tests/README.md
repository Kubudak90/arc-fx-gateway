# Tests — Arcora WooCommerce gateway

Unit coverage for the webhook trust boundary (HMAC signature verification), the
one gate between a forged HTTP request and an order being marked paid.

## Run

```bash
cd plugins/arcora-woocommerce
composer install       # pulls phpunit + brain/monkey (dev-only)
composer test          # or: vendor/bin/phpunit
```

No running WordPress or MySQL is required: the verifiers are pure PHP
(`hash_hmac` + `hash_equals`), and the bootstrap only defines `ABSPATH` and loads
the webhook class. Brain\Monkey is wired for WP-function stubbing so the suite can
grow toward full `handle()` integration tests.

## What's covered

`WebhookSignatureTest` exercises the verification decision at
`class-wc-arcora-webhook.php:182` (`verify_timestamped_v2`) and the primitives it
delegates to:

- **`verify_signature_v2` — 7-case matrix:** correct signature; wrong secret;
  tampered body; tampered timestamp (the V2 scheme binds the timestamp);
  missing `sha256=` prefix; empty header; and a legacy-scheme signature rejected
  as V2.
- **`verify_timestamped_v2` accept paths:** an in-window valid delivery and a
  timestamp near the replay tolerance.
- **`verify_signature` (legacy) parity:** accept + wrong-secret / tampered-body /
  bad-prefix rejects.

## Known boundary

The reject branches of `verify_timestamped_v2` emit their `401` through
`respond()`, which calls `exit` — not interceptable in-process — so their HTTP
status/body are not asserted here. The security-relevant decision (is this
signature valid?) is fully covered at the `verify_signature_v2` seam; asserting
the exit-driven 401 responses end-to-end is a future `handle()` integration test
using PHPUnit process isolation.
