-- 0016: V10 cutover wipe.
-- Hard cutover from V8/V9 → V10 with a single test merchant on testnet.
-- TRUNCATE preserves schema; CASCADE walks FK chains.
-- Order independent thanks to CASCADE, but listed leaf-to-root for clarity.

TRUNCATE TABLE
  webhook_attempts,
  rate_limit_counters,
  checkout_authorizations,
  compliance_screenings,
  invoices,
  merchants
RESTART IDENTITY CASCADE;

-- indexer_state cursor must reset so we don't try to reconcile V9 logs into V10 schema
DELETE FROM indexer_state;
