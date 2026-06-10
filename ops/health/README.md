# Arcora stack health cron

`arcora-health.sh` is the single liveness check for the testnet stack on the
ops VPS (194.163.136.1). It runs every 10 minutes from cron; like
`ops/vault/vault-rotation-health.sh`, it is **silent when healthy** and prints
\+ exits non-zero on failure so the cron `MAILTO` mails the operator only when
something is actually wrong.

## What it checks

| # | Check | FAIL condition |
|---|---|---|
| 1 | `systemctl is-active` for `arcora-indexer`, `arcora-relayer`, `arcora-webhooks`, `vault` | any unit not `active` |
| 2 | Relayer queue age — oldest `relayer_queue` row in a non-terminal status (`pending`/`processing`), measured from `created_at` | older than `ARCORA_QUEUE_MAX_AGE_SECONDS` (default 900 s = 15 min), or the query itself fails |
| 3 | `GET https://arcorapay.xyz/api/health` (10 s timeout) | non-200/404 response, timeout, or connection failure. **404 is currently WARN-only** (see below) |

Check 2 reuses the relayer daemon's own DB config: it reads
`POSTGRES_URL_NON_POOLING` from `/opt/arcora-ops/relayer/.env` (the unit's
`EnvironmentFile`) and connects with `sslmode=verify-full` against the pinned
Supabase CA extracted from `/opt/arcora-ops/relayer/supabase-ca.ts` — same
AFG-011 trust anchor the daemons use. `crosschain_payments` is deliberately
not age-checked: its attestation-poll states are legitimately long-lived
(up to 2 h by `CROSSCHAIN_ATTESTATION_DEADLINE_MS`).

## TODO — flip the app-endpoint 404 to FAIL after Task 10

`/api/health` exists in the app code but is **not deployed to production
yet** (the deploy is Task 10 of the public-beta launch plan). Until then a
404 is the expected steady state, so the script treats it as WARN and stays
quiet about it (no mail every 10 minutes). Anything else that isn't a 200 —
5xx, timeout, TLS failure — is already a FAIL today.

**After the Task 10 deploy lands**, flip 404 to a hard failure by adding
`ARCORA_APP_404=fail` to the cron file (or change the script default):

```
*/10 * * * * root ARCORA_APP_404=fail /root/arcora-ops/health/arcora-health.sh
```

## Install on the VPS

Same conventions as the vault rotation health check (script under
`/root/arcora-ops/`, cron file under `/etc/cron.d/` with `MAILTO=root`):

```bash
mkdir -p /root/arcora-ops/health
cp ops/health/arcora-health.sh /root/arcora-ops/health/
chmod +x /root/arcora-ops/health/arcora-health.sh

cat > /etc/cron.d/arcora-health <<EOF
SHELL=/bin/bash
MAILTO=root
*/10 * * * * root /root/arcora-ops/health/arcora-health.sh
EOF
```

Using a dedicated `/etc/cron.d/arcora-health` file (rather than editing the
root crontab) means existing cron entries are never touched.

## Manual runs / testing

```bash
# verbose pass (prints every check line):
ARCORA_HEALTH_VERBOSE=1 /root/arcora-ops/health/arcora-health.sh

# prove the failure path without touching live units:
ARCORA_UNITS="arcora-bogus" /root/arcora-ops/health/arcora-health.sh; echo "exit=$?"
```

Knobs (all env, all optional): `ARCORA_UNITS`, `ARCORA_RELAYER_DIR`,
`ARCORA_RELAYER_ENV_FILE`, `ARCORA_QUEUE_MAX_AGE_SECONDS`,
`ARCORA_APP_HEALTH_URL`, `ARCORA_APP_404` (`warn`|`fail`),
`ARCORA_HEALTH_VERBOSE`.
