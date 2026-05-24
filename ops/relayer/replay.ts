/**
 * Operator recovery CLI for the arcora-relayer queue. Three modes:
 *
 *   pnpm tsx replay.ts list [--status <s>]
 *     Print queue rows. Default shows non-terminal (pending|processing|failed).
 *
 *   pnpm tsx replay.ts requeue --id <uuid>
 *     Flip a failed (or stuck-processing) row back to pending so the daemon
 *     re-tries it on its next tick. Resets `attempts` to 0 and clears
 *     `next_attempt`. Use after the upstream issue is fixed (e.g. App Kit
 *     liquidity restored, gateway un-paused).
 *
 *   pnpm tsx replay.ts force-refund --id <uuid>
 *     Manually mark a row `refunded` and call `gateway.recordPayerRefund`.
 *     Use when the relayer pulled funds, the swap failed, but the auto
 *     refund step couldn't run (e.g. RPC outage). The operator must have
 *     already moved the pay-in token back to the customer manually.
 *
 * Run from `/root/arcora-ops/relayer/` on the VPS, or locally after
 * `cd ops/relayer && pnpm install`.
 *
 * V10 NOTE: RELAYER_PRIVATE_KEY has been replaced by VAULT_* env vars.
 * force-refund authenticates via Vault transit (same as the daemon).
 * Required env: VAULT_URL, VAULT_ROLE_ID, VAULT_SECRET_ID, VAULT_KV_PATH (kvField defaults to "privateKey").
 */

import {
  createPublicClient, createWalletClient, http, parseAbi,
  type Address, type Hex,
} from "viem";
import pg from "pg";
import { vaultSigner } from "./vault-signer";

const PG_URL      = need("POSTGRES_URL_NON_POOLING");

function need(k: string): string {
  const v = process.env[k];
  if (!v) throw new Error(`missing env ${k}`);
  return v;
}

const pool = new pg.Pool({ connectionString: PG_URL, ssl: { rejectUnauthorized: false } });

const GATEWAY_ABI = parseAbi([
  "function recordPayerRefund(bytes32 globalId, address payer, address payInToken, uint256 amount, bytes32 reasonHash)",
]);

function parseArgs(argv: string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        out.set(key, "true");
      } else {
        out.set(key, next);
        i++;
      }
    }
  }
  return out;
}

async function listRows(status?: string): Promise<void> {
  const r = status
    ? await pool.query(
        `select id, invoice_id, payer, status, attempts, last_error, created_at
           from relayer_queue
          where status = $1
          order by created_at desc
          limit 50`,
        [status],
      )
    : await pool.query(
        `select id, invoice_id, payer, status, attempts, last_error, created_at
           from relayer_queue
          where status in ('pending','processing','failed')
          order by created_at desc
          limit 50`,
      );

  if (r.rowCount === 0) {
    console.log("[list] no rows");
    return;
  }
  for (const row of r.rows) {
    console.log(JSON.stringify(row));
  }
}

async function requeue(id: string): Promise<void> {
  const r = await pool.query<{ status: string }>(
    `update relayer_queue
        set status = 'pending', attempts = 0,
            next_attempt = now(), last_error = null,
            updated_at = now()
      where id = $1
        and status in ('failed','processing')
      returning status`,
    [id],
  );
  if (r.rowCount === 0) {
    throw new Error(`row ${id} not found, or not in failed/processing state`);
  }
  console.log(`[requeue] ${id} → pending`);
}

async function forceRefund(id: string): Promise<void> {
  const RPC     = need("ARC_TESTNET_RPC");
  const GATEWAY = need("GATEWAY_ADDRESS").toLowerCase() as Address;

  const r = await pool.query<{
    invoice_id: string; payer: string; pay_in_token: string; amount_in: string; status: string;
  }>(
    `select invoice_id, payer, pay_in_token, amount_in, status
       from relayer_queue
      where id = $1`,
    [id],
  );
  if (r.rowCount === 0) throw new Error(`row ${id} not found`);
  const row = r.rows[0]!;
  // Audit Ops-M5 (2026-05-24): also block `refunded`. If the daemon already
  // completed an automatic refund, calling forceRefund again would re-issue
  // recordPayerRefund (which would revert with InvoiceNotInCreatedState) and
  // re-stamp refund_tx_hash, destroying the evidence of the original refund
  // before the operator noticed.
  if (row.status === "settled" || row.status === "refunded") {
    throw new Error(`row already ${row.status} — cannot force-refund. Use the merchant refund flow instead.`);
  }

  const account = await vaultSigner({
    vaultUrl: need("VAULT_URL"),
    roleId:   need("VAULT_ROLE_ID"),
    secretId: need("VAULT_SECRET_ID"),
    kvPath:   need("VAULT_KV_PATH"),
    kvField:  process.env.VAULT_KV_FIELD ?? "privateKey",
  });
  const wallet = createWalletClient({ account, transport: http(RPC) });
  const chain  = createPublicClient({ transport: http(RPC) });

  const reasonHash = ("0x" +
    Array.from(new TextEncoder().encode("operator-force-refund".slice(0, 32)))
      .map(b => b.toString(16).padStart(2, "0")).join("")
      .padEnd(64, "0")
  ) as Hex;

  const tx = await wallet.writeContract({
    chain: undefined,
    address: GATEWAY,
    abi: GATEWAY_ABI,
    functionName: "recordPayerRefund",
    args: [
      row.invoice_id as Hex,
      row.payer as Address,
      row.pay_in_token as Address,
      BigInt(row.amount_in),
      reasonHash,
    ],
  });
  await chain.waitForTransactionReceipt({ hash: tx });

  await pool.query(
    `update relayer_queue
        set status = 'refunded', refund_tx_hash = $2,
            last_error = 'operator-force-refund',
            updated_at = now()
      where id = $1`,
    [id, tx],
  );

  console.log(`[force-refund] ${id} → refunded (tx ${tx})`);
}

async function main() {
  const [, , subcommand, ...rest] = process.argv;
  const args = parseArgs(rest);

  try {
    if (subcommand === "list") {
      await listRows(args.get("status"));
    } else if (subcommand === "requeue") {
      const id = args.get("id");
      if (!id) throw new Error("usage: replay.ts requeue --id <uuid>");
      await requeue(id);
    } else if (subcommand === "force-refund") {
      const id = args.get("id");
      if (!id) throw new Error("usage: replay.ts force-refund --id <uuid>");
      await forceRefund(id);
    } else {
      console.error("usage:");
      console.error("  replay.ts list [--status pending|processing|settled|refunded|failed]");
      console.error("  replay.ts requeue --id <uuid>");
      console.error("  replay.ts force-refund --id <uuid>");
      process.exitCode = 2;
    }
  } finally {
    await pool.end();
  }
}

main().catch(e => {
  console.error("[replay] fatal:", e instanceof Error ? e.message : e);
  process.exit(1);
});
