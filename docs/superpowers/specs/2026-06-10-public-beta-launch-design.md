# Public Beta Launch + Clean Repo Publication — Design Spec

**Date:** 2026-06-10
**Status:** Approved by user
**Branding:** Product = **Arcorapay**, an **Arcora Labs** product. New public home: `github.com/arcoralabs/arcorapay` (repo exists, public, empty).

## Context

The app is live on Arc testnet at arcorapay.xyz (UI v2 deployed today). A readiness audit
(two Explore agents + infra checks, 2026-06-10) found the project beta-ready except for
four gaps, and the user wants the project re-published as a fresh single-commit repo
under the Arcora Labs org, with all content (litepaper, roadmap, docs, site links)
updated to current reality first.

Old history is NOT carried over (it contains a leaked deployer key event and internal
churn); local working repo keeps its history privately.

## Goals

1. Close the four public-beta gaps: legal pages, lightweight observability + VPS audit
   rollout, SDK 1.1.0 npm prep, onboarding pass.
2. Update all public-facing content to current state (litepaper, roadmap, docs, README,
   site links → arcoralabs/arcorapay).
3. Publish the cleaned tree as a single "Initial commit" on `main` of
   `https://github.com/arcoralabs/arcorapay.git`, then redeploy production.

## Non-goals

- Anything on the mainnet T-0 list (HSM, multisig, external audit, KYB, compliance
  flip, V12 redeploy, env-driven chain selection).
- Sentry / external monitoring SaaS (user chose lightweight, self-hosted checks).
- Renaming the Vercel project or npm scope.

## Phase A — Beta gaps

### A1. Legal pages
- New routes `packages/app/app/terms/page.tsx` and `packages/app/app/privacy/page.tsx`,
  UI v2 styled (topbar + prose), English, testnet-beta wording:
  - Operator: "Arcorapay, an Arcora Labs product" (contact via GitHub org).
  - Terms: testnet only, no real monetary value, no warranty/SLA, may reset data,
    acceptable use, MIT-licensed software disclaimer.
  - Privacy: what is processed (wallet addresses, merchant emails if any, IPs in logs,
    cookies/localStorage for session + theme), no sale of data, retention, contact.
- Footer (SiteFooter) gains Terms / Privacy links; checkout + merchant login footers
  link them too where natural.

### A2. Lightweight observability + VPS audit rollout
- App: `GET /api/health` — checks DB (`select 1`), Arc RPC (`eth_blockNumber`),
  returns `{ ok, db, rpc, version (package.json), commit (env) }`; no auth, rate-limited,
  no secrets in output.
- VPS (ops host): one new `ops/health/` script set (cron, MAILTO pattern like
  `ops/vault/vault-rotation-health.sh`):
  - daemon liveness (systemctl is-active for the 3 arcora units + vault),
  - relayer queue-age alarm: oldest unfinished `relayer_queue` row > threshold → mail,
  - app health: curl `https://arcorapay.xyz/api/health`.
- VPS rollout of committed-but-undeployed audit fixes:
  - AFG-021: systemd units run as dedicated `arcora` user with sandboxing
    (NoNewPrivileges, ProtectSystem=strict, etc.) per the repo's hardened unit files,
  - AFG-011: CA-pinning env for Vault client per remediation plan.
  - Follow `docs/runbooks/` + `docs/audit/2026-06-06-full-scope/remediation-plan.md`.

### A3. SDK 1.1.0 npm prep (publish is a user step, 2FA)
- `CHANGELOG.md`: add 1.1.0 section (AFG-019 publishable-key model, CDN bundle) and
  app-side v1.1/v1.2 entries to close the gap since 1.0.3.
- Version sync: `packages/sdk` and `packages/sdk-react` both at 1.1.0 (per RELEASING.md
  matching-versions rule).
- `pnpm publish --dry-run` both packages; tarball contents verified.
- Hand the user the exact publish commands (run via `!` in-session or their terminal).

### A4. Onboarding pass
- Walk `/quickstart` as a stranger: wallet add (AddArcTestnetButton), faucet link works,
  demo invoice can be created and paid on testnet, docs links resolve.
- Fix friction/broken links found; no scope creep beyond link/copy fixes.

## Phase B — Content updates (to current reality)

### B1. LITEPAPER.md
Update: version v1.2 + UI v2 shipped; cross-chain v2 demo status; audit status
(2026-06-06 internal full-scope, all off-chain findings remediated; V12 contract items
tracked); links → arcoralabs/arcorapay; branding "Arcorapay by Arcora Labs"; roadmap
section mirrors B2. Regenerate `LITEPAPER.pdf` only if tooling exists in repo;
otherwise note staleness in commit message.

### B2. ROADMAP.md + site roadmap
Single source of truth: shipped (v1.0→v1.2, UI v2, audit remediation), current (public
beta on Arc testnet, cross-chain v2 demo), next (beta feedback, Q2 observability/
failover), gated (mainnet T-0 checklist unchanged). Site `app/page.tsx` ROADMAP_ITEMS
and `/docs` pages updated to match.

### B3. Docs + links + README
- All 15+ `Kubudak90/arc-fx-gateway` references → `arcoralabs/arcorapay` (site pages,
  docs pages, SDK READMEs, package.json repository fields, badges).
- Root `README.md` rewritten for the new public repo: what Arcorapay is, live demo
  link (arcorapay.xyz), architecture overview, packages table, quickstart, docs links,
  license, "an Arcora Labs product".
- `CHANGELOG.md` current (from A3). `KNOWN_ISSUES.md` reviewed/refreshed (it is honest
  and stays public).

## Phase C — Clean publication

### C1. Public-tree curation (security-critical)
The fresh repo must NOT include:
- `docs/superpowers/` (internal specs/plans — contains strategy/funding details),
- `docs/audit/` (contains OPEN vulnerability details — V12 carry incl. H-1 — against
  the LIVE testnet contract) and `docs/runbooks/` is reviewed file-by-file: ops
  runbooks with server specifics stay private; generic ones may stay,
- `.claude/`, `.superpowers/`, any local tooling state,
- anything the secret sweep flags.
Mechanism: these paths are EXCLUDED from the export (not gitignored-but-present —
simply absent from the public tree). SECURITY.md keeps responsible-disclosure contact
and notes audits are available to partners on request.

### C2. Secret sweep (working tree only — history isn't carried)
- Verify `.env*` are gitignored and absent from export; only `.env.example` ships and
  contains placeholders.
- Grep sweep for: private keys (0x[0-9a-f]{64}), `IRON_SESSION`, `MASTER_KEY` values,
  the ops-VPS IP, passwords, `sk_`/`ak_live_` style keys, email addresses,
  Vault tokens, seed phrases. Every hit reviewed; real values removed/replaced.
- `pnpm-lock.yaml` etc. fine.

### C3. Fresh single-commit publish
- In the existing local repo: create orphan branch `main`
  (`git checkout --orphan main`), stage the curated tree (exclusions applied via a
  one-time removal on the orphan branch — local private branches keep everything),
  single commit "Initial commit", `git remote add public
  https://github.com/arcoralabs/arcorapay.git`, `git push -u public main`.
- Local work continues on the private history; the `public` remote only ever receives
  curated trees.
- New-repo hygiene: LICENSE present (MIT), repo description + topics set via gh,
  default branch main.

### C4. Verify + redeploy
- GitHub: README renders, no excluded paths present, no secrets (spot grep on the
  pushed tree via gh api).
- Vercel: `vercel --prod --yes` from repo root (content changed); verify arcorapay.xyz
  serves updated links (footer GitHub link → arcoralabs) and `/api/health` returns ok.
- `RELEASING.md` updated: repo URL, publish flow unchanged.

## Risks

| Risk | Mitigation |
|---|---|
| Secret leaks into public tree | C2 sweep is a hard gate before push; reviewer verifies independently |
| Open-vuln audit docs go public | C1 exclusion list; reviewer greps pushed tree for audit file names |
| Orphan-branch mistake nukes local history | All work on new branch; private branches untouched; no force-push to old remote |
| VPS hardening rollout breaks daemons | Apply per runbook one unit at a time, verify each `systemctl status` + a settle smoke test after |
| Litepaper/roadmap claims drift from truth | Content tasks cite repo evidence; reviewer checks claims vs code |

## Acceptance

1. arcorapay.xyz: /terms, /privacy live; footer links; /api/health ok in prod.
2. VPS: daemons running as non-root hardened units; health crons mailing on failure
   (test-fire once); CA pinning env in place.
3. CHANGELOG current; SDK packages at 1.1.0, dry-run clean; publish commands handed over.
4. Litepaper/roadmap/docs/README reflect current state; zero `Kubudak90`/`arc-fx-gateway`
   references in the public tree (Vercel project name may remain internally).
5. `arcoralabs/arcorapay` has exactly one commit on main, curated tree, no secrets,
   no excluded paths.
6. Production redeployed; all gates green (typecheck/lint/test/e2e).
