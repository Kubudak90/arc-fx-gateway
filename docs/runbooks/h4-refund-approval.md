# H4 — Refund-Approval Invariant (V9)

V9 `refundInvoice` uses `safeTransferFrom(payoutSource, ...)`. The payout
wallet must keep an open ERC20 allowance to the gateway, otherwise a
refund attempt reverts on-chain.

## Onboarding requirement
When a merchant configures their payout wallet (split-wallet flow), the
dashboard MUST verify `allowance(payoutSource, gateway) >= expected_max_refund`
before activating the merchant. If not, show a "Grant approval" CTA.

## Monitoring
Run hourly (Vercel Cron `/api/internal/cron/h4-allowance-check`):
- For every active merchant, read `allowance(payoutSource, gateway)`.
- For every merchant where `allowance < sum(open invoices not yet refunded)`,
  page the operator and flag the merchant in the dashboard.

## Future
V10 will own the funds via custody model — eliminating the allowance
dependency entirely. ETA: see `docs/superpowers/specs/<v10-plan-when-written>`.
Until then, this runbook + cron is the workaround.
