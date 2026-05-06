ui      = false
api_addr = "http://127.0.0.1:8200"

storage "file" {
  path = "/var/lib/vault/data"
}

listener "tcp" {
  address     = "127.0.0.1:8200"
  tls_disable = 1
}

# secp256k1 plugin loaded post-install (see ops/vault/README.md).
plugin_directory = "/etc/vault.d/plugins"
