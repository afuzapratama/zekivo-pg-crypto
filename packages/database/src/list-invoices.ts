import type pg from "pg";
import type { InvoiceListQuery } from "../../contracts/src/invoices.js";
import { formatAmount } from "../../domain/src/amount.js";
export class InvalidInvoiceCursor extends Error {}
export async function listInvoices(
  pool: pg.Pool,
  projectId: string | null,
  environment: string,
  cluster: string,
  query: InvoiceListQuery,
  includeProject = false,
) {
  const scope = [projectId, environment, cluster];
  if (query.before) {
    const anchor = await pool.query(
      "SELECT 1 FROM invoices WHERE id=$4 AND ($1::uuid IS NULL OR project_id=$1) AND environment=$2 AND cluster=$3",
      [...scope, query.before],
    );
    if (!anchor.rowCount)
      throw new InvalidInvoiceCursor("Invalid invoice cursor");
  }
  const limit = query.limit ?? 25;
  // Compare timestamps inside PostgreSQL: JS Dates would truncate microseconds.
  // ID is a deterministic tie-breaker when several invoices share created_at.
  const result = await pool.query(
    `SELECT project_id,(SELECT name FROM projects p WHERE p.id=invoices.project_id) AS project_name,id,order_id,invoice_version,asset,cluster,status,base_units,payable_units,created_at,expires_at,payment_enabled
    FROM invoices WHERE ($1::uuid IS NULL OR project_id=$1) AND environment=$2 AND cluster=$3
    AND ($4::text IS NULL OR status=$4) AND ($5::text IS NULL OR asset=$5) AND ($6::text IS NULL OR order_id=$6)
    AND ($7::uuid IS NULL OR (created_at,id)<(SELECT created_at,id FROM invoices WHERE id=$7 AND ($1::uuid IS NULL OR project_id=$1) AND environment=$2 AND cluster=$3))
    ORDER BY created_at DESC,id DESC LIMIT $8`,
    [
      ...scope,
      query.status ?? null,
      query.asset ?? null,
      query.order_id ?? null,
      query.before ?? null,
      limit + 1,
    ],
  );
  const rows = result.rows.slice(0, limit);
  return {
    items: rows.map((row) => ({
      ...(includeProject
        ? { project_id: row.project_id, project_name: row.project_name }
        : {}),
      id: row.id,
      order_id: row.order_id,
      invoice_version: row.invoice_version,
      asset: row.asset,
      cluster: row.cluster,
      status: row.status,
      amount: formatAmount(BigInt(row.base_units)),
      payable_amount: formatAmount(BigInt(row.payable_units)),
      created_at: row.created_at,
      expires_at: row.expires_at,
      payment_enabled: row.payment_enabled === true,
    })),
    next_cursor:
      result.rows.length > limit ? (rows.at(-1)!.id as string) : null,
  };
}
