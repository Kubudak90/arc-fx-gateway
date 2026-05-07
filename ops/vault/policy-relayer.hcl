# Relayer can sign with the v10 transit key and read its public key
# (for address derivation). Cannot export, rotate, or delete keys.
path "transit/sign/relayer-v10" {
  capabilities = ["update"]
}

path "transit/keys/relayer-v10" {
  capabilities = ["read"]
}
