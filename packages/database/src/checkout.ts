import type pg from "pg";
import { Conflict, serializeInvoice } from "./invoices.js";

export async function checkoutInvoice(
  pool: pg.Pool,
  token: string,
  environment: string,
  cluster: string,
  origin: string,
) {
  const row = (
    await pool.query(
      `SELECT i.*, now() AS server_time,
      ARRAY(SELECT DISTINCT t.disposition FROM chain_transfers t WHERE t.invoice_id=i.id AND t.disposition <> 'paid') AS review_reasons,
      (SELECT json_agg(json_build_object('asset',a.asset,'amount',to_char(a.base_units::numeric/1000000,'FM9999999990.000000')) ORDER BY a.asset)
       FROM payment_attempts a WHERE a.invoice_id=i.id) AS payment_options
     FROM invoices i WHERE i.checkout_token=$1 AND i.environment=$2 AND i.cluster=$3`,
      [token, environment, cluster],
    )
  ).rows[0];
  if (!row) return null;
  const invoice = serializeInvoice(row, origin);
  return {
    ...(invoice.price_currency
      ? {
          price_currency: invoice.price_currency,
          price_amount: invoice.price_amount,
          description: invoice.description,
          quote: invoice.quote,
        }
      : {}),
    invoice_version: row.invoice_version,
    asset: invoice.asset,
    cluster: invoice.cluster,
    status: invoice.status,
    amount: invoice.amount,
    payable_amount: invoice.payable_amount,
    expires_at: invoice.expires_at,
    server_time: row.server_time,
    payment_enabled: invoice.payment_enabled,
    recipient: invoice.recipient,
    mint: invoice.mint,
    reference: invoice.reference,
    review_reasons: row.review_reasons,
    payment_options: row.payment_options,
  };
}

export async function selectAsset(
  pool: pg.Pool,
  token: string,
  environment: string,
  cluster: string,
  asset: string,
  expectedVersion: number,
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const invoice = (
      await client.query(
        "SELECT * FROM invoices WHERE checkout_token=$1 AND environment=$2 AND cluster=$3 FOR UPDATE",
        [token, environment, cluster],
      )
    ).rows[0];
    if (!invoice) {
      await client.query("ROLLBACK");
      return null;
    }
    if (invoice.invoice_version !== expectedVersion)
      throw new Conflict("Invoice changed; refresh before selecting an asset");
    const allowed = await client.query(
      `SELECT 1 FROM invoices i WHERE i.id=$1 AND i.status='pending' AND i.payment_enabled AND i.expires_at>clock_timestamp()
       AND NOT EXISTS (SELECT 1 FROM chain_transfers t WHERE t.invoice_id=i.id)`,
      [invoice.id],
    );
    if (!allowed.rowCount)
      throw new Conflict("Asset selection is closed for this invoice");
    const attempt = (
      await client.query(
        "SELECT * FROM payment_attempts WHERE invoice_id=$1 AND asset=$2 AND payment_enabled",
        [invoice.id, asset],
      )
    ).rows[0];
    if (!attempt) throw new Conflict("Asset has no merchant-approved quote");
    if (invoice.asset === asset) {
      await client.query("COMMIT");
      return { invoice_version: invoice.invoice_version };
    }
    await client.query(
      "UPDATE payment_attempts SET activated_at=COALESCE(activated_at,clock_timestamp()) WHERE id=$1",
      [attempt.id],
    );
    const updated = (
      await client.query(
        `UPDATE invoices SET asset=$2,mint=$3,recipient=$4,reference=$5,base_units=$6,payable_units=$7,invoice_version=invoice_version+1 WHERE id=$1 RETURNING invoice_version`,
        [
          invoice.id,
          attempt.asset,
          attempt.mint,
          attempt.recipient,
          attempt.reference,
          attempt.base_units,
          attempt.payable_units,
        ],
      )
    ).rows[0];
    await client.query(
      "INSERT INTO audit_logs(project_id,action,entity_id) VALUES($1,'invoice.asset_selected',$2)",
      [invoice.project_id, invoice.id],
    );
    await client.query("COMMIT");
    return updated;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
