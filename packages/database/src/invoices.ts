import { getBase58Decoder } from "@solana/kit";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type pg from "pg";
import type { InvoiceInput } from "../../contracts/src/invoices.js";
import { parseAmount, formatAmount } from "../../domain/src/amount.js";
export class Conflict extends Error {}
export function serializeInvoice(
  row: Record<string, unknown>,
  webOrigin: string,
) {
  return {
    id: row.id,
    invoice_version: row.invoice_version,
    order_id: row.order_id,
    asset: row.asset,
    cluster: row.cluster,
    status: row.status,
    amount: formatAmount(BigInt(String(row.base_units))),
    payable_amount: formatAmount(BigInt(String(row.payable_units))),
    expires_at: row.expires_at,
    checkout_url: `${webOrigin}/pay/${row.checkout_token}`,
    payment_enabled: row.payment_enabled === true,
    recipient: row.payment_enabled ? row.recipient : null,
    mint: row.payment_enabled ? row.mint : null,
    reference: row.reference ?? null,
  };
}
export async function createInvoice(
  pool: pg.Pool,
  projectId: string,
  environment: string,
  cluster: string,
  key: string,
  input: InvoiceInput,
  enablePayments = false,
) {
  const base = parseAmount(input.amount);
  const options = (
    input.payment_options ?? [{ asset: input.asset, amount: input.amount }]
  )
    .map((option) => ({
      asset: option.asset,
      units: parseAmount(option.amount),
    }))
    .sort((a, b) => a.asset.localeCompare(b.asset));
  if (
    new Set(options.map((option) => option.asset)).size !== options.length ||
    !options.some(
      (option) => option.asset === input.asset && option.units === base,
    )
  )
    throw new Conflict(
      "Payment options must be distinct and include the initial asset at its quoted amount",
    );
  const normalized = {
    ...input,
    amount: base.toString(),
    expires_in_seconds: input.expires_in_seconds ?? 1800,
  };
  const hash = createHash("sha256")
    .update(
      JSON.stringify([
        normalized.order_id,
        normalized.asset,
        normalized.amount,
        normalized.expires_in_seconds,
        ...(options.length > 1
          ? [options.map((option) => [option.asset, option.units.toString()])]
          : []),
      ]),
    )
    .digest("hex");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Shared lock serializes allocation, including the first invoice in an empty DB.
    await client.query("SELECT pg_advisory_xact_lock(70102)");
    const previous = await client.query(
      "SELECT request_hash,invoice_id FROM idempotency_records WHERE project_id=$1 AND key=$2",
      [projectId, key],
    );
    if (previous.rows[0]) {
      if (previous.rows[0].request_hash !== hash)
        throw new Conflict("Idempotency key was used with a different request");
      const existing = await client.query(
        "SELECT * FROM invoices WHERE id=$1",
        [previous.rows[0].invoice_id],
      );
      await client.query("COMMIT");
      return { row: existing.rows[0], replayed: true };
    }
    if (
      (
        await client.query(
          "SELECT 1 FROM invoices WHERE project_id=$1 AND order_id=$2",
          [projectId, input.order_id],
        )
      ).rowCount
    )
      throw new Conflict("Order already has an invoice");
    // Foundation reservations use explicit placeholders; no checkout transfer is enabled.
    const configured = await client.query(
      "SELECT * FROM token_configs WHERE environment=$1 AND cluster=$2 AND asset=$3",
      [environment, cluster, input.asset],
    );
    const token = enablePayments ? configured.rows[0] : undefined;
    if (enablePayments && !token)
      throw new Conflict("Token configuration missing");
    const mint = token?.mint ?? `${cluster}:mock:${input.asset}`;
    const recipient = token?.recipient ?? `${cluster}:receiving-not-configured`;
    const reference = token ? getBase58Decoder().decode(randomBytes(32)) : null;
    const allocated = await client.query(
      `SELECT candidate::text FROM generate_series($1::bigint+1,$1::bigint+9999) candidate
   WHERE NOT EXISTS (SELECT 1 FROM payment_attempts WHERE environment=$2 AND cluster=$3 AND mint=$4 AND recipient=$5 AND payable_units=candidate)
   ORDER BY candidate LIMIT 1`,
      [base.toString(), environment, cluster, mint, recipient],
    );
    if (!allocated.rows[0]) throw new Conflict("Unique amount range exhausted");
    const created = await client.query(
      `INSERT INTO invoices(id,project_id,environment,cluster,asset,recipient,mint,order_id,base_units,payable_units,checkout_token,expires_at,payment_enabled,reference)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now()+$12*interval '1 second',$13,$14) RETURNING *`,
      [
        randomUUID(),
        projectId,
        environment,
        cluster,
        input.asset,
        recipient,
        mint,
        input.order_id,
        base.toString(),
        allocated.rows[0].candidate,
        randomBytes(32).toString("base64url"),
        normalized.expires_in_seconds,
        Boolean(token),
        reference,
      ],
    );
    const row = created.rows[0];
    await client.query(
      `INSERT INTO payment_attempts(id,invoice_id,environment,cluster,asset,recipient,mint,reference,base_units,payable_units,payment_enabled,created_at,expires_at,activated_at)
       SELECT id,id,environment,cluster,asset,recipient,mint,reference,base_units,payable_units,payment_enabled,created_at,expires_at,created_at FROM invoices WHERE id=$1`,
      [row.id],
    );
    for (const option of options.filter(
      (option) => option.asset !== input.asset,
    )) {
      const config = enablePayments
        ? (
            await client.query(
              "SELECT * FROM token_configs WHERE environment=$1 AND cluster=$2 AND asset=$3",
              [environment, cluster, option.asset],
            )
          ).rows[0]
        : undefined;
      if (enablePayments && !config)
        throw new Conflict("Token configuration missing");
      const optionMint = config?.mint ?? `${cluster}:mock:${option.asset}`;
      const optionRecipient =
        config?.recipient ?? `${cluster}:receiving-not-configured`;
      const reserved = await client.query(
        `SELECT candidate::text FROM generate_series($1::bigint+1,$1::bigint+9999) candidate
         WHERE NOT EXISTS (SELECT 1 FROM payment_attempts WHERE environment=$2 AND cluster=$3 AND mint=$4 AND recipient=$5 AND payable_units=candidate)
         ORDER BY candidate LIMIT 1`,
        [
          option.units.toString(),
          environment,
          cluster,
          optionMint,
          optionRecipient,
        ],
      );
      if (!reserved.rows[0])
        throw new Conflict("Unique amount range exhausted");
      await client.query(
        `INSERT INTO payment_attempts(id,invoice_id,environment,cluster,asset,recipient,mint,reference,base_units,payable_units,payment_enabled,created_at,expires_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          randomUUID(),
          row.id,
          environment,
          cluster,
          option.asset,
          optionRecipient,
          optionMint,
          config ? getBase58Decoder().decode(randomBytes(32)) : null,
          option.units.toString(),
          reserved.rows[0].candidate,
          Boolean(config),
          row.created_at,
          row.expires_at,
        ],
      );
    }
    await client.query("INSERT INTO idempotency_records VALUES($1,$2,$3,$4)", [
      projectId,
      key,
      hash,
      created.rows[0].id,
    ]);
    await client.query(
      "INSERT INTO audit_logs(project_id,action,entity_id) VALUES($1,'invoice.created',$2)",
      [projectId, created.rows[0].id],
    );
    await client.query("COMMIT");
    return { row: created.rows[0], replayed: false };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
