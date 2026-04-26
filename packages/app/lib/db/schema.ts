import {
  pgTable, text, uuid, timestamp, integer, numeric, jsonb, customType, boolean, pgEnum,
} from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer; default: false }>({
  dataType() { return "bytea"; },
});

export const invoiceStatus = pgEnum("invoice_status", ["created", "paid", "expired"]);

export const merchants = pgTable("merchants", {
  id: uuid("id").defaultRandom().primaryKey(),
  address: text("address").notNull().unique(),
  payoutToken: text("payout_token").notNull(),
  webhookUrl: text("webhook_url"),
  apiKeyHash: text("api_key_hash").notNull(),
  webhookSecretEnc: bytea("webhook_secret_enc").notNull(),
  webhookSecretIv: bytea("webhook_secret_iv").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const invoices = pgTable("invoices", {
  id: text("id").primaryKey(), // chain globalId = keccak256(merchant, merchantInvoiceId)
  merchantInvoiceId: text("merchant_invoice_id").notNull(),
  merchantId: uuid("merchant_id").notNull().references(() => merchants.id),
  payInToken: text("pay_in_token").notNull(),
  payoutToken: text("payout_token").notNull(), // locked at creation
  amountOut: numeric("amount_out").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  status: invoiceStatus("status").notNull(),
  paidBy: text("paid_by"),
  paidTx: text("paid_tx"),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  metadata: jsonb("metadata"),
  successUrl: text("success_url").notNull(),
  cancelUrl: text("cancel_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const webhookAttempts = pgTable("webhook_attempts", {
  id: uuid("id").defaultRandom().primaryKey(),
  invoiceId: text("invoice_id").notNull().references(() => invoices.id),
  url: text("url").notNull(),
  payload: jsonb("payload").notNull(),
  attempts: integer("attempts").notNull().default(0),
  nextAttempt: timestamp("next_attempt", { withTimezone: true }).notNull(),
  succeededAt: timestamp("succeeded_at", { withTimezone: true }),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const indexerState = pgTable("indexer_state", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const serverWallets = pgTable("server_wallets", {
  id: uuid("id").defaultRandom().primaryKey(),
  address: text("address").notNull().unique(),
  encryptedPk: bytea("encrypted_pk").notNull(),
  pkIv: bytea("pk_iv").notNull(),
  balanceAlertBelow: numeric("balance_alert_below"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const siweNonces = pgTable("siwe_nonces", {
  nonce: text("nonce").primaryKey(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  used: boolean("used").notNull().default(false),
});
