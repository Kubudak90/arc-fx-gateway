# Rotation-operator policy — least-privilege grant for the daily AppRole
# secret_id rotation cron. Audit 2026-05-13 follow-up: the cron previously
# used /root/.vault-token (root token, full Vault access). This policy is
# scoped to exactly the three operations secret-id-rotation.sh performs.
#
# 2026-06-13 fix: the original policy granted ONLY the secret-id mint, but the
# rotation script also (a) reads the role to assert secret_id_num_uses==0 and
# (b) does a verify-before-commit test login with the freshly minted secret_id
# before overwriting the live one. Without those two grants the cron failed at
# the role-read pre-check (403 -> pipefail -> exit 2). A fresh box applying the
# old policy would have hit the same wall.
#
# Apply on prod:
#   vault policy write rotation-operator ops/vault/policy-rotation-operator.hcl
#   vault token create -policy=rotation-operator -display-name=cron-rotation \
#     -orphan -ttl=8760h -renewable=true -field=token > /etc/arcora/rotation-operator.token
#   chmod 600 /etc/arcora/rotation-operator.token
#   # Update cron to source from the new token file (see ops/vault/secret-id-rotation.sh).

# Mint a fresh secret_id.
path "auth/approle/role/relayer/secret-id" {
  capabilities = ["update"]
}

# Read role config to assert secret_id_num_uses==0 before rotating (the
# verify-before-commit test login below consumes a use; a capped role would
# self-lock — the exact 2026-05-12 outage class this guard prevents).
path "auth/approle/role/relayer" {
  capabilities = ["read"]
}

# Verify-before-commit: prove the new secret_id authenticates BEFORE the
# working credential is overwritten. Only the relayer role_id+secret_id are
# ever known to this token, so login grants nothing beyond what the secret_id
# already does.
path "auth/approle/login" {
  capabilities = ["create", "update"]
}
