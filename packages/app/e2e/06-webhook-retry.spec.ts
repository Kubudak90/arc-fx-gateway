import { test, expect } from "@playwright/test";
import { clearAll, seedMerchant, seedInvoice, newPool } from "./fixtures/seed";

test("webhook dispatcher records attempts on 5xx", async ({ request }) => {
  await clearAll();
  const m = await seedMerchant({ webhookUrl: "https://httpbin.org/status/500" });
  const id = await seedInvoice({ merchantId: m.merchantId, status: "paid" });

  const pool = newPool();
  await pool.query(
    `INSERT INTO webhook_attempts (invoice_id, url, payload, attempts, next_attempt)
     VALUES ($1, 'https://httpbin.org/status/500', $2, 0, NOW())`,
    [id, JSON.stringify({ event_id: "test", type: "invoice.paid", invoice_id: id })],
  );
  await pool.end();

  const res = await request.post("http://localhost:3001/api/cron/dispatch-webhooks", {
    headers: { authorization: `Bearer ${process.env.CRON_SECRET ?? "secret"}` },
  });
  expect(res.status()).toBe(200);

  const pool2 = newPool();
  const result = await pool2.query("SELECT attempts, last_error FROM webhook_attempts WHERE invoice_id = $1", [id]);
  await pool2.end();
  expect(Number(result.rows[0].attempts)).toBe(1);
  expect(result.rows[0].last_error).toMatch(/500/);
});
