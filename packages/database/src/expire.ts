import { randomUUID } from "node:crypto";
import type pg from "pg";
import { formatAmount } from "../../domain/src/amount.js";
export async function expireInvoices(
  pool: pg.Pool,
  scope: { APP_ENV: string; SOLANA_CLUSTER: string },
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const rows = (
      await client.query(
        "WITH due AS (SELECT id FROM invoices WHERE environment=$1 AND cluster=$2 AND status='pending' AND expires_at<=now() ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 100) UPDATE invoices i SET status='expired',invoice_version=invoice_version+1 FROM due WHERE i.id=due.id RETURNING i.*",
        [scope.APP_ENV, scope.SOLANA_CLUSTER],
      )
    ).rows;
    for (const row of rows) {
      const eventId = randomUUID();
      const payload = {
        event_id: eventId,
        event_type: "payment.expired",
        schema_version: 1,
        occurred_at: new Date().toISOString(),
        project_id: row.project_id,
        data: {
          ...(row.price_currency === "USD"
            ? {
                price_currency: "USD",
                price_amount: row.price_amount,
                quote: (row.price_quotes as Record<string, unknown>)?.[
                  String(row.asset)
                ],
              }
            : {}),
          invoice_id: row.id,
          invoice_version: row.invoice_version,
          order_id: row.order_id,
          cluster: row.cluster,
          asset: row.asset,
          mint: row.mint,
          recipient: row.recipient,
          invoice_status: row.status,
          amount_expected: formatAmount(BigInt(row.payable_units)),
          expires_at: new Date(row.expires_at).toISOString(),
          transfers: [],
        },
      };
      await client.query(
        "INSERT INTO webhook_events(event_id,invoice_id,event_type,payload)VALUES($1,$2,'payment.expired',$3)",
        [eventId, row.id, payload],
      );
    }
    await client.query("COMMIT");
    return { rowCount: rows.length };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
