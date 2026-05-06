# V10 deploy runbook

## Pre-flight

- [ ] `plan-10-v10-custody` branch green: forge tests + vitest + tsc
- [ ] Vault running on VPS, transit key `relayer-v10` generated, public key derived → relayer address recorded as `GATEWAY_RELAYER`
- [ ] `DEPLOYER_PRIVATE_KEY` and `GATEWAY_OWNER` set (admin EOA)
- [ ] USDC + EURC testnet addresses on Arc confirmed

## Deploy

```
cd packages/contracts
PROTOCOL_FEE_BPS=30 \
REFUND_WINDOW_SECONDS=604800 \
ADMIN_RECOVERY_DELAY=604800 \
SUPPORTED_TOKENS="0x<USDC>,0x<EURC>" \
forge script script/DeployV10.s.sol \
  --broadcast --legacy --rpc-url $ARC_RPC -vvv
```

## Verify (Foundry-broadcast-lies caveat from MEMORY.md)

```
cast receipt <txHash> --rpc-url $ARC_RPC | grep status
# expect: status 1
cast code <V10Address> --rpc-url $ARC_RPC | wc -c
# expect: > 100 (non-empty bytecode)
```

## Wire env

### Vercel (packages/app)
```
GATEWAY_ADDRESS_V10=0x…
# remove: GATEWAY_ADDRESS_V6, V8, V9, H4_MIN_BOOTSTRAP_ALLOWANCE
```

### VPS (/etc/arcora/relayer.env, /etc/arcora/indexer.env)
```
GATEWAY_ADDRESS_V10=0x…
VAULT_URL=http://127.0.0.1:8200
VAULT_ROLE_ID=…
VAULT_SECRET_ID=…
VAULT_KEY_NAME=relayer-v10
# remove: RELAYER_PRIVATE_KEY, GATEWAY_ADDRESS_V6/V8/V9
```

## DB migrations (apply in order)

```
psql $DATABASE_URL_DIRECT -f packages/app/lib/db/migrations/0016_v10_wipe.sql
psql $DATABASE_URL_DIRECT -f packages/app/lib/db/migrations/0017_v10_escrow.sql
```

## Restart daemons on the VPS

```
ssh root@194.163.136.1 'systemctl reload arcora-relayer arcora-indexer'
```

## Re-bootstrap as merchant

1. Visit `https://arcorapay.xyz`, SIWE in, hit `/m/dashboard`
2. Bootstrap as merchant — single TX → V10 `registerMerchant`
3. Verify `GATEWAY_ADDRESS_V10` matches in the dashboard footer (or wherever it's surfaced)

## Smoke flow

| Step | Expected |
|------|----------|
| Create invoice (USDC pay-in, USDC payout, $10) | `created` row in DB, `InvoiceCreated` event |
| Pay it from a wallet | `paid` row, escrow created, `EscrowCreated` event, no transfer to merchant |
| Refund within 7 days | customer made whole (full $10), `refunded` status |
| Create + pay another | escrow row visible in `/m/treasury` Claim tab |
| Wait 7 days (or warp time on a fork) | "Claim all" button enables |
| Click Claim | merchant payoutAddress receives net, fee accrued, `claimed` status |
| Deactivate merchant | `MerchantDeactivated`, `deactivated_at` timestamp set |
| Wait 14 days, admin recover | `recovered` status, funds at sweep address |
| Reactivate via admin | `active = true` again, `deactivated_at` cleared |

## Rollback

V10 is immutable — there's no rollback. If V10 has a critical bug found post-deploy:
1. Pause via admin (`gw.pause()`)
2. Refund / claim outstanding escrows (refunds work paused)
3. Deploy V11 with the fix; cut over the same way (DB wipe is now optional since V10 already had clean state)
