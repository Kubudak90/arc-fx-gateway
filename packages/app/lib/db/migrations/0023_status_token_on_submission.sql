-- Bind the checkout status-detail token to the SUBMISSION (relayer_queue row)
-- instead of the invoice. ADDITIVE + IDEMPOTENT. Audit LOW (2026-07-05):
-- the invoice-scoped token let a later submitter on the same invoice read an
-- earlier submission's tx hashes/error. The invoices.status_token columns are
-- left in place (harmless, now unused) rather than dropped destructively.
ALTER TABLE "relayer_queue" ADD COLUMN IF NOT EXISTS "status_token" text;
ALTER TABLE "relayer_queue" ADD COLUMN IF NOT EXISTS "status_token_expires_at" timestamp with time zone;
