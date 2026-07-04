# LOW/hardening triage — 2026-07-04 sweep

Disposition of every LOW item in [`audit-2026-07-04-full-sweep.md`](./audit-2026-07-04-full-sweep.md).
All H/M findings were fixed same-day (commits `9bb8cf6`…`052ab35`); this pass works the tail.
**FIXED** = code landed in this commit. **DEFERRED** = real, scheduled, with a home.
**ACCEPTED** = risk understood and consciously kept, with rationale.

## FIXED (this commit)

| Item | Fix |
|---|---|
| `permit2.ts` Math.random nonce fallback | Throws when WebCrypto is unavailable — never degrades to a predictable nonce. |
| `db/client.ts` malformed `POSTGRES_URL` → no `ssl` | Fails closed: unparseable URL still gets `{rejectUnauthorized:true}`. |
| `checkout/v2/deposit` unauthenticated + unrate-limited, `depositTx` unverified | Per-IP limiter (matches checkout/submit) + `depositTx` receipt must be a successful tx emitting a `Deposited` log for the claimed escrowId from the escrow contract (else 409). |
| v2 invoice `amount` unbounded | `1 minor unit … $1M` in `lib/v2/createInvoice.ts` — parity with v1 App-L-7/M1, enforced below every caller (API + MCP). |
| `rate/clientIp.ts` trusts platform headers everywhere | `x-vercel-forwarded-for`/`x-real-ip` only honoured when `VERCEL` is set (self-host opt-in: `TRUST_REAL_IP=1`); also strengthened a sibling test that passed vacuously. |
| `ops/relayer/cctp.ts` IRIS fetch can hang the serial loop | `AbortSignal.timeout(15s)` → a stalled IRIS is a retryable per-row error, not a full-relayer halt. |
| `v2-keeper.ts` drain has no lease | `pg_try_advisory_lock` on a dedicated connection serializes whole passes; second instance skips. (Row-level `SKIP LOCKED` rejected: rows span multi-second on-chain calls — far too long to hold row locks in a tx.) |
| `v2-keeper.ts` `setState` interpolates column names | `SETTLEMENT_SET_COLUMNS` allowlist, mirroring `CROSSCHAIN_MARK_COLUMNS`. |
| `run.ts` same-token settle skips token constraint | `tokenSymbolForArcAddress(row.pay_in_token)` now also runs on the same-token branch. |
| `vault-signer.ts` permits plaintext http loopback | http loopback now requires `VAULT_ALLOW_HTTP_LOOPBACK=1` (dev only); deployed Vault is https. |
| `ops/vault/install.sh` unverified binary download | SHA256SUMS verification (abort on mismatch); bashrc export corrected to `https` + `VAULT_CACERT`. |
| `agent-commerce-core/commerce.ts` raw LLM `invoiceId` in URL | Pinned to `0x[0-9a-fA-F]{64}` + `encodeURIComponent`, matching `refund.ts`. |
| `sdk/client.ts` secret key over any transport | `INSECURE_BASE_URL` error: `ak_` key + plaintext `http` to non-loopback → throw at `resolveBaseUrl` (every call path). |
| `cli.ts` prints full `ak_live_` to stdout | Stdout gets `renderConfigsMasked` (key truncated); real key only in the chmod-600 file. |
| `cli.ts` re-onboard keeps loose file perms | `chmodSync(0o600)` after write, like `wallet.ts`. |
| `config-writer.ts` unpinned `npx -y` | Generated configs pin `@arcora/agent-commerce@<exact>`; `PKG_VERSION` sync with package.json is test-enforced. |

## DEFERRED → RESOLVED (worked 2026-07-05)

The whole DEFERRED tail was worked in a follow-up pass. Outcomes:

- **Webhook signature has no timestamp/expiry** — **ALREADY SHIPPED, no action needed.** The live
  dispatcher (`ops/webhooks/run.ts`) already dual-signs every delivery with the timestamped
  `X-Arcora-Signature-V2` (HMAC over `<ts>.<body>`) + `X-Arcora-Timestamp` (Ops-M2, 2026-05-24), and
  the SDK's `verifyWebhook` checks it against a 300s replay window. The finding pointed at
  `lib/crypto/webhook.ts`'s `signWebhook` — a body-only helper with ZERO non-test callers. It's now
  marked DEPRECATED/UNUSED so nobody wires the replayable form into a live path.
- **`checkout/status/[id]` token invoice-scoped** — **FIXED.** Token moved to the `relayer_queue`
  row (migration `0023`); the status route validates against the row it already fetched (dropping a
  second query), so a later submitter on the same invoice can't read an earlier one's detail.
  Regression test added (`a DIFFERENT submission's token can't unlock this row`).
- **`renounceRole(DEFAULT_ADMIN_ROLE)` can brick admin** — **FIXED in code (deploys at mainnet).**
  `ArcFXGateway` now tracks the admin count via `_grantRole`/`_revokeRole` overrides and reverts
  `CannotRemoveLastAdmin` on the last removal — covers both `revokeRole` and `renounceRole`. 5 tests
  in `test/gateway/AdminRole.t.sol`. (No redeploy today; lands with the mainnet contract rev.)
- **Invariant under-coverage + reentrancy gaps** — **FIXED.** `Invariant.t.sol` now runs two
  merchants on different payout tokens (EURC + USDC → non-trivial multi-token solvency) and exercises
  `adminRecoverEscrow` + `recordPayerRefund`; `Reentrancy.t.sol` arms `claim` and `adminRecoverEscrow`
  (was `refundInvoice` only). Contract suite 96→103 tests, all green. Closes RFP §4 pre-audit gaps.
- **Slither baseline keying + stale `STATE.md`** — **FIXED.** `slither_keys` now includes the finding
  start line (fail-SAFE: a new medium+ can't collapse onto an existing baseline key); the verdict
  rewrites a marked New-findings block every run, so a CLEAR wipes stale BLOCKED findings instead of
  letting them accumulate.

## ACCEPTED (kept, with rationale)

- **`/api/health` returns the deployed commit SHA unauthenticated** — deliberate deploy-identity probe; used by the VPS health cron and deploy verification. Repo is public and prod tracks HEAD, so the SHA discloses little an attacker can't infer; body remains secret-free. Re-evaluate at mainnet (noted in MAINNET-READINESS).
- **Relayer fully controls refund destination / can fail `Created` invoices** — inherent to the relayer's role in v1's design; the mitigation is key custody (Vault) + the documented single-VPS blast radius, both already in MAINNET-READINESS. No code change short of v2 (which removes the custody path entirely).
- **`claim` blockable by a USDC-blacklisted merchant payout address** — 14-day `adminRecoverEscrow` path exists and is the designed exit; merchant self-service payout updates for deactivated merchants is a product decision, not a security fix.
- **LI.FI `minOut` trusted verbatim** — on-chain re-enforcement is the actual guard (sweep itself rated this defense-in-depth INFO).
- **Merchant webhook key plaintext at rest in `~/.arcora`** (agent-commerce) — file is chmod-600 on a user machine; encrypting at rest with a key stored beside it adds no real barrier. Documented in the CLI README threat notes.
- **Anvil default test key in `/test/`** — publicly-published test constant, no funds. Non-issue.

## User-action items (not code)

- **Commit author email** is a personal address across history in a public repo — history rewrite is not worth it; switching future commits to a GitHub noreply address is a one-liner (`git config user.email`), owner: user.
