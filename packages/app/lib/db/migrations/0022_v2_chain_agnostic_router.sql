-- v2 chain-agnostic CCTP router — ADDITIVE + IDEMPOTENT.
-- Safe to apply on a DB that already carries the v1 schema: every statement is
-- guarded (IF NOT EXISTS / duplicate_object) so it only creates the NEW v2 objects
-- and never drops or alters a v1 column. (drizzle-kit's auto-diff bundled stale-
-- snapshot drift; this migration is hand-trimmed to the true v2 delta only.)

-- ── enums ───────────────────────────────────────────────────────────────────
DO $$ BEGIN CREATE TYPE "currency" AS ENUM ('USDC','EURC','USDT'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "settlement_path" AS ENUM ('A','B','C'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "settlement_state" AS ENUM (
  'INVOICE_CREATED','AWAITING_DEPOSIT','DEPOSITED','SETTLING','SETTLED',
  'BURN_SENT','ATTESTATION_PENDING','RECEIVE_SENT',
  'PAYOUT_FAILED','RECOVERED_TO_BUYER','SETTLED_FALLBACK_USDC',
  'REFUND_REQUESTED','REFUNDED','EXPIRED'
); EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ── merchants: v2 payout config (own address, no custody) ───────────────────
ALTER TABLE "merchants" ADD COLUMN IF NOT EXISTS "payout_chain_id" integer;
ALTER TABLE "merchants" ADD COLUMN IF NOT EXISTS "payout_address" text;
ALTER TABLE "merchants" ADD COLUMN IF NOT EXISTS "payout_currency" "currency";

-- ── invoices: v2 fields (nullable; only set on v2 invoices) ─────────────────
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "currency" "currency";
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "idempotency_key" text;
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "invoice_ref" text;
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "escrow_id" text;
CREATE UNIQUE INDEX IF NOT EXISTS "invoices_merchant_idempotency_key"
  ON "invoices" ("merchant_id","idempotency_key") WHERE "idempotency_key" IS NOT NULL;

-- ── settlements: durable Store backing the @arcora/router Orchestrator ──────
CREATE TABLE IF NOT EXISTS "settlements" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "invoice_id" text NOT NULL,
  "invoice_ref" text NOT NULL,
  "escrow_id" text,
  "path" "settlement_path",
  "escrow_chain_id" integer,
  "escrow_domain" integer,
  "payout_chain_id" integer NOT NULL,
  "payout_domain" integer NOT NULL,
  "payout_token" "currency" NOT NULL,
  "amount" numeric NOT NULL,
  "merchant" text NOT NULL,
  "payer" text,
  "state" "settlement_state" DEFAULT 'INVOICE_CREATED' NOT NULL,
  "deposit_tx" text,
  "burn_tx" text,
  "cctp_message" text,
  "cctp_attestation" text,
  "receive_tx" text,
  "settle_tx" text,
  "recover_tx" text,
  "fee_tx" text,
  "lease_owner" text,
  "lease_expires_at" timestamp with time zone,
  "last_error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
DO $$ BEGIN
  ALTER TABLE "settlements" ADD CONSTRAINT "settlements_invoice_id_invoices_id_fk"
    FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id");
EXCEPTION WHEN duplicate_object THEN null; END $$;
CREATE UNIQUE INDEX IF NOT EXISTS "settlements_invoice_ref" ON "settlements" ("invoice_ref");
CREATE UNIQUE INDEX IF NOT EXISTS "settlements_escrow_id" ON "settlements" ("escrow_id") WHERE "escrow_id" IS NOT NULL;
