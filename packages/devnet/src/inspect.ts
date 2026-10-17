import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { devnetEnvironment } from "./environment.js";
import { createPool } from "../../database/src/pool.js";
const env = devnetEnvironment();
const pool = createPool(env.DATABASE_URL!);
try {
  const { invoice } = JSON.parse(
    await readFile(
      fileURLToPath(
        new URL(
          process.argv.includes("--usdt")
            ? "../../../.devnet/invoice-usdt.json"
            : "../../../.devnet/invoice.json",
          import.meta.url,
        ),
      ),
      "utf8",
    ),
  );
  const result = await pool.query(
    `SELECT id,status,asset,payable_units::text,invoice_version FROM invoices WHERE id=$1 AND project_id=$2 AND environment='staging' AND cluster='devnet'`,
    [invoice.id, env.DEVNET_PROJECT_ID],
  );
  if (!result.rows[0])
    throw new Error("Invoice not found in configured Devnet project");
  const transfers = await pool.query(
    "SELECT signature,amount::text,disposition,slot::text FROM chain_transfers WHERE invoice_id=$1",
    [invoice.id],
  );
  const events = await pool.query(
    "SELECT event_id,event_type,created_at FROM webhook_events WHERE invoice_id=$1",
    [invoice.id],
  );
  console.log(
    JSON.stringify({
      invoice: result.rows[0],
      transfers: transfers.rows,
      events: events.rows,
      webhook_delivery_enabled: false,
    }),
  );
} finally {
  await pool.end();
}
