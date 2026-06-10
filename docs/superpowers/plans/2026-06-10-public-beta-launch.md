# Public Beta Launch + Clean Repo Publication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the four public-beta gaps, update all public content to current reality, and publish the curated tree as a single "Initial commit" to `github.com/arcoralabs/arcorapay`, then redeploy production.

**Architecture:** Work lands on `feat/public-beta-launch` (off `plan-1-protocol`) and merges back so the private repo stays source of truth. The public repo only ever receives curated orphan-branch snapshots. VPS work is applied unit-by-unit per existing runbooks.

**Tech Stack:** Next.js 15 / Tailwind v4 app, pnpm monorepo, systemd + HashiCorp Vault on VPS 194.163.136.1, Vercel (manual CLI deploys), gh CLI.

**Spec:** `docs/superpowers/specs/2026-06-10-public-beta-launch-design.md`
**Branch:** create `feat/public-beta-launch` from `plan-1-protocol` first.
**Working dir:** repo root `arcorapay/`.

---

### Task 1: Legal pages (/terms, /privacy)

**Files:**
- Create: `packages/app/app/terms/page.tsx`, `packages/app/app/privacy/page.tsx`
- Modify: `packages/app/components/landing/SiteFooter.tsx` (add links), `packages/app/app/i/[invoiceId]/page.tsx` (small footer line link)

- [ ] **Step 1:** Read `packages/app/app/docs/page.tsx` + `DocsShell.tsx` for the established prose/topbar pattern; read `SiteFooter.tsx`.
- [ ] **Step 2:** Build both pages, UI v2 styled (topbar with ArcoraLogo + back link, `.wrap` prose column, `.eyebrow` section labels), English, with `export const metadata` titles "Terms of Service · Arcorapay" / "Privacy Policy · Arcorapay". Content requirements (write full real copy, no lorem):
  - Terms: operator "Arcorapay, an Arcora Labs product"; service is a TESTNET beta — tokens have no monetary value; no warranty, no SLA, data may be reset; acceptable use (no abuse/illegal use, no attempts to exploit); software under MIT license, service "as is"; changes to terms; contact via https://github.com/arcoralabs/arcorapay/issues.
  - Privacy: processed data = wallet addresses (public chain data), merchant-provided config (webhook URLs, origins), session cookie (iron-session), theme preference in localStorage, IP addresses in transient server logs and rate-limit windows; no analytics trackers, no sale of data; retention = testnet resets clear DB data, logs rotate; third parties = Vercel (hosting), Circle App Kit (quotes/swaps), RPC providers; contact via GitHub.
  - Footer of each page: "Last updated 2026-06-10".
- [ ] **Step 3:** Add "Terms" and "Privacy" links to `SiteFooter.tsx` legal row, and a small "Terms · Privacy" mono line in the hosted-checkout card footer area.
- [ ] **Step 4:** `pnpm --filter @arcora/app typecheck && pnpm --filter @arcora/app test` green; dev-server screenshot both pages (dark+light).
- [ ] **Step 5:** Commit: `git add packages/app && git commit -m "feat(app): terms of service + privacy policy pages"`

### Task 2: App health endpoint

**Files:**
- Create: `packages/app/app/api/health/route.ts`, `packages/app/app/api/health/route.test.ts` (if API route tests exist — check `packages/app/test/` conventions first; otherwise a vitest unit on the handler helpers)

- [ ] **Step 1 (TDD):** Write failing test: GET returns 200 with `{ ok: true, db: true, rpc: true, version: <string> }` when deps are up; 503 with `ok:false` and the failing component false when DB or RPC check throws. Mock db/rpc clients per existing test conventions (see how other API route tests mock `lib/db` — check `packages/app/test/helpers`).
- [ ] **Step 2:** Implement: `select 1` via the existing drizzle client; `eth_blockNumber` via the existing viem public client (`lib/chain/client.ts`); `version` from `package.json` import; 3s timeout per check (Promise.race); never include secrets/URLs in the response; wrap with the existing rate limiter (`lib/rate/limiter.ts`) using a generous window (e.g. 30/min/IP) — read how other routes consume it and follow that pattern exactly. Fail-open note: if the limiter itself throws, still serve health (it must not depend on DB being up to report DB being down — call limiter best-effort in try/catch).
- [ ] **Step 3:** Tests green; `curl localhost:3000/api/health` shows the shape.
- [ ] **Step 4:** Commit: `feat(app): /api/health endpoint for uptime monitoring`

### Task 3: VPS — health crons + audit-fix rollout (LIVE INFRA — careful, one unit at a time)

**Files:**
- Create: `ops/health/README.md`, `ops/health/arcora-health.sh` (in repo), then deployed to VPS
- VPS changes per existing runbooks (no new repo files needed beyond ops/health)

Reference reading FIRST: `docs/audit/2026-06-06-full-scope/remediation-plan.md` (AFG-021, AFG-011 phases), `ops/vault/README.md` + `ops/vault/vault-rotation-health.sh` (cron+MAILTO pattern), `ops/relayer/README.md`, existing systemd unit files in the repo (find with `grep -rl "ExecStart" ops/`).

- [ ] **Step 1:** Write `ops/health/arcora-health.sh`: checks `systemctl is-active` for `arcora-indexer arcora-relayer arcora-webhooks vault`; queries Postgres for oldest unfinished relayer_queue row age (read the queue table name/status values from `ops/relayer/run.ts` and the drizzle schema — use the same DB connection env the relayer uses); curls `https://arcorapay.xyz/api/health`; any failure → non-zero exit + message on stdout (cron MAILTO delivers it). Mirror the style of `vault-rotation-health.sh`.
- [ ] **Step 2:** Commit the script + README (`ops/health/README.md` documents install: crontab entry `*/10 * * * *` with MAILTO, same mailbox as vault health).
- [ ] **Step 3 (VPS, ssh root@194.163.136.1):** Install the health cron. Test-fire once by stopping nothing — instead run the script manually and confirm clean pass; then temporarily point it at a bogus unit name to confirm the failure path emails/prints, restore.
- [ ] **Step 4 (VPS, AFG-021):** Apply the hardened systemd units from the repo (dedicated `arcora` user, NoNewPrivileges, ProtectSystem) — per the remediation plan. ONE UNIT AT A TIME: `systemctl daemon-reload && systemctl restart <unit> && systemctl status <unit>` and tail journal for a clean settle/poll cycle before the next unit. If any unit fails to start under hardening, revert that unit, document why, continue with the rest.
- [ ] **Step 5 (VPS, AFG-011):** Apply CA-pinning env for the Vault client per remediation plan; restart relayer; verify it boots and fetches the key (journal shows the existing "relayer address verified" log).
- [ ] **Step 6:** Run `packages/app/scripts/smoke-prod.ts` (read its README/usage first) or create+pay a testnet invoice end-to-end to prove settle still works after hardening.
- [ ] **Step 7:** Commit repo-side files: `feat(ops): health-check cron for daemons, queue age, and app endpoint`

### Task 4: CHANGELOG + SDK 1.1.0 prep

**Files:**
- Modify: `CHANGELOG.md`, `packages/sdk/package.json` (verify 1.1.0), `packages/sdk-react/package.json` (bump to 1.1.0), `KNOWN_ISSUES.md` (npm version line)

- [ ] **Step 1:** Read `CHANGELOG.md` (ends at 1.0.3), git tags `v1.1.0`/`v1.2.0` commit ranges (`git log v1.0.3..v1.2.0 --oneline`) and write accurate `## [1.1.0]` and `## [1.2.0]` sections (+ an Unreleased section for UI v2 + this launch work). SDK-specific 1.1.0 notes: publishable-key model (AFG-019), CDN script bundle.
- [ ] **Step 2:** Version sync per RELEASING.md: both SDK packages at `1.1.0` (sdk already is; bump sdk-react from 1.0.0 → 1.1.0).
- [ ] **Step 3:** `pnpm --filter @arcora/sdk publish --dry-run --no-git-checks` and same for sdk-react → tarballs contain `dist/`, `LICENSE`, `README.md`, `package.json` and nothing else. Paste evidence.
- [ ] **Step 4:** Run both package test suites (`pnpm --filter @arcora/sdk test`, `pnpm --filter @arcora/sdk-react test`) — green.
- [ ] **Step 5:** Commit: `chore(release): changelog through v1.2 + sdk 1.1.0 version sync`. Report the exact user-side publish commands (NOT run): `pnpm --filter @arcora/sdk publish --no-git-checks` + same for sdk-react.

### Task 5: Onboarding pass (stranger walkthrough)

**Files:** fix-only — whatever the walkthrough surfaces (links/copy), expected mostly in `packages/app/app/quickstart/page.tsx`, `packages/app/app/docs/**`

- [ ] **Step 1:** Dev server (CSP-strip Playwright pattern). As a no-context visitor: landing → quickstart → add Arc testnet to wallet (verify `AddArcTestnetButton` params against `lib/chain/client.ts`) → faucet path (find the faucet URL the page references; verify it responds) → `/checkout-demo` invoice → docs links. Click every external link on landing/docs/quickstart; record status codes.
- [ ] **Step 2:** Fix what's broken (links, stale copy, wrong addresses). Do NOT redesign anything.
- [ ] **Step 3:** typecheck + tests green; commit `fix(app): onboarding walkthrough fixes`.

### Task 6: Content — LITEPAPER + ROADMAP + site roadmap + docs status

**Files:**
- Modify: `docs/LITEPAPER.md`, `docs/ROADMAP.md`, `packages/app/app/page.tsx` (ROADMAP_ITEMS const only), `packages/app/app/docs/**` status copy, `ROADMAP.md` (root, if it duplicates docs/)

- [ ] **Step 1:** Evidence pass: read `docs/LITEPAPER.md` §9–11, `docs/ROADMAP.md`, `KNOWN_ISSUES.md`, CHANGELOG (now current from Task 4), and the live ROADMAP_ITEMS in `page.tsx`. List every stale claim (version, dates, audit status, links, "planned" items that shipped).
- [ ] **Step 2:** Update content to current reality — shipped: v1.0→v1.2, UI v2 redesign (2026-06-10), 2026-06-06 internal audit fully remediated off-chain; current: public beta on Arc testnet (arcorapay.xyz), cross-chain v2 demo in development; next: beta feedback, Q2 observability/failover; gated on Arc mainnet: the unchanged pre-mainnet checklist. Branding "Arcorapay — an Arcora Labs product"; all repo links → `github.com/arcoralabs/arcorapay`. IMPORTANT: do not overclaim — keep the honest "testnet demo, not a production payment rail" framing; never state an external audit happened (it has not).
- [ ] **Step 3:** PDF artifacts (`LITEPAPER.pdf`, roadmap PDFs/HTML in docs/): check how they were generated (`docs/litepaper.css`, any script). If a repeatable generator exists, regenerate; if not, DELETE the stale PDFs/HTML from the public-bound tree (note in Task 8 exclusions) rather than ship outdated claims.
- [ ] **Step 4:** typecheck + tests green (page.tsx const edit). Commit: `docs: litepaper + roadmap + site roadmap updated to current state`.

### Task 7: Link sweep + new README + RELEASING

**Files:**
- Modify: every file matching `grep -rl "Kubudak90\|arc-fx-gateway" --exclude-dir=node_modules --exclude-dir=.git .` (excluding `.vercel/project.json` — Vercel project name stays), root `README.md` (full rewrite), `RELEASING.md`, `packages/*/package.json` repository/homepage/bugs fields, `SECURITY.md` (disclosure contact → new repo; add "internal audit reports available to partners on request").

- [ ] **Step 1:** Run the grep; replace GitHub URLs with `https://github.com/arcoralabs/arcorapay` (keep `arc-fx-gateway.vercel.app` deploy alias references ONLY in RELEASING.md internal doc; the public site should use arcorapay.xyz everywhere).
- [ ] **Step 2:** Rewrite root `README.md` for the public repo: one-paragraph what-it-is ("Stablecoin checkout & settlement on Arc — accept any supported stablecoin, settle in the one you choose"), live beta link (arcorapay.xyz), feature bullets, architecture sketch (app / contracts / sdk / ops daemons), packages table, quickstart (pnpm install/dev), docs pointers, testnet disclaimer, MIT license, "Arcorapay is an Arcora Labs product".
- [ ] **Step 3:** Verify zero hits: `grep -rn "Kubudak90" . --exclude-dir=node_modules --exclude-dir=.git` and `grep -rn "arc-fx-gateway" packages/app/app packages/app/components packages/sdk packages/sdk-react docs README.md` (RELEASING.md exempt).
- [ ] **Step 4:** typecheck + full unit suite green (the no-fabricated-content suite watches copy — keep claims honest). Commit: `docs: point all public references at arcoralabs/arcorapay, new public README`.

### Task 8: Secret sweep + curation manifest

**Files:**
- Create: `docs/superpowers/public-exclusions.txt` (the canonical exclusion list, lives only in private tree)

- [ ] **Step 1:** Write the exclusion list (paths NOT shipped publicly): `docs/superpowers/`, `docs/audit/`, `docs/runbooks/` entries containing infra specifics (review file-by-file; generic dev runbooks may ship), `docs/loom-script.md`, internal PDFs/HTML decks deemed stale in Task 6, `.claude/`, `.superpowers/`, `KNOWN_ISSUES.md`? — NO, it ships (honest, public-safe; re-read to confirm no secrets/IPs), plus anything Step 2 flags.
- [ ] **Step 2:** Working-tree secret sweep (the public tree = HEAD tree minus exclusions):
  - `git ls-files | xargs grep -lE "0x[0-9a-fA-F]{64}"` — review every hit (test fixtures with well-known anvil keys are acceptable ONLY if clearly labeled test keys; anything else is a finding)
  - grep for `194.163.136.1`, `Asusf8va` (must be ZERO anywhere), `IRON_SESSION_PASSWORD=`, `MASTER_KEY=`, `VAULT_TOKEN`, `secret-id`, `BEGIN.*PRIVATE KEY`, `ak_live_`, `sk_live_`, real email addresses
  - verify `git check-ignore .env .env.local packages/app/.env.local packages/contracts/.env` all ignored and `git ls-files | grep -E "\.env$|\.env\.local"` is empty
  - `.env.example` files: every value is a placeholder
- [ ] **Step 3:** Fix findings (replace/remove), commit fixes separately: `chore: scrub public tree (secret sweep findings)`. Then commit the exclusion manifest.
- [ ] **Step 4:** Report: full sweep evidence + final exclusion list for the Task 9 publisher.

### Task 9: Merge + orphan publish to arcoralabs/arcorapay

- [ ] **Step 1:** Merge `feat/public-beta-launch` → `plan-1-protocol` (PR per repo habit or direct merge — match how PR #9 was done; run full gates after merge: typecheck, lint, unit, e2e).
- [ ] **Step 2:** From the merged `plan-1-protocol`:
```bash
git checkout --orphan main
git rm -r --cached . -q
git add -A
# apply exclusions from docs/superpowers/public-exclusions.txt:
#   git rm -r --cached <each excluded path> && rm -rf NOT used — instead:
#   for each excluded path: git rm -r --cached <path> (files stay on disk, absent from commit)
git commit -m "Initial commit"
git remote add public https://github.com/arcoralabs/arcorapay.git 2>/dev/null || true
git push -u public main
git checkout plan-1-protocol
```
  CAREFUL: `--orphan` + `git rm --cached` only — NEVER `rm -rf` working files; local branches/history must remain intact. Verify after returning to plan-1-protocol that `git status` is clean and history intact (`git log --oneline -3`).
- [ ] **Step 3:** Verify the pushed tree via `gh api repos/arcoralabs/arcorapay/git/trees/main?recursive=1 --jq '.tree[].path'`: exactly one commit (`gh api repos/arcoralabs/arcorapay/commits --jq 'length'`), zero excluded paths (grep the tree listing for `docs/superpowers`, `docs/audit`, `.claude`), `.env` absent, LICENSE + README present.
- [ ] **Step 4:** Repo polish: `gh repo edit arcoralabs/arcorapay --description "Stablecoin checkout & settlement on Arc — accept any stablecoin, settle the one you want. Arc testnet beta." --homepage "https://arcorapay.xyz" --add-topic stablecoin --add-topic payments --add-topic arc --add-topic usdc --add-topic web3`
- [ ] **Step 5:** Commit nothing further; report tree stats + URL.

### Task 10: Redeploy + live verification

- [ ] **Step 1:** `vercel --prod --yes` from repo root (on merged plan-1-protocol).
- [ ] **Step 2:** Live checks on https://arcorapay.xyz: `/api/health` returns ok json; `/terms` + `/privacy` render; footer GitHub link → arcoralabs/arcorapay (curl the HTML and grep); landing roadmap shows updated items; no `Kubudak90` string in served HTML of `/`, `/docs`, `/quickstart`.
- [ ] **Step 3:** VPS health cron still green post-deploy (`ssh … 'bash /root/arcora-ops/health/arcora-health.sh || true'` — adjust to install path used in Task 3).
- [ ] **Step 4:** Report final acceptance table vs spec §Acceptance.
