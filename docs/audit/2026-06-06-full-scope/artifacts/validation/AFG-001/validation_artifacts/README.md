# AFG-001 Bounded PoC

Run from the repository root:

```sh
node docs/audit/2026-06-06-full-scope/artifacts/validation/AFG-001/validation_artifacts/poc.cjs
```

The harness uses only a local loopback HTTP server. It models the worker's separate safety and fetch lookups by returning a public address to the first lookup and loopback to the connection lookup. It does not modify system DNS or contact an external host.
