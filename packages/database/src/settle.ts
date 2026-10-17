import { randomUUID } from "node:crypto";
import type pg from "pg";
import { formatAmount } from "../../domain/src/amount.js";
import type { TokenConfig, DecodedTransfer } from "../../solana/src/decode.js";
export async function settleTransfer(
  pool: pg.Pool,
  config: TokenConfig,
  signature: string,
  transfer: DecodedTransfer,
) {
  if (
    transfer.mint !== config.mint ||
    transfer.destination !== config.token_account ||
    transfer.amount <= 0n
  )
    throw new Error("Transfer does not match verified token configuration");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(70103)");
    const inserted = await client.query(
      `INSERT INTO chain_transfers(environment,cluster,signature,instruction_path,slot,block_time,mint,destination,amount,disposition) VALUES($1,$2,$3,$4,$5,to_timestamp($6),$7,$8,$9,'unmatched') ON CONFLICT DO NOTHING RETURNING id`,
      [
        config.environment,
        config.cluster,
        signature,
        transfer.path,
        transfer.slot,
        transfer.blockTime,
        transfer.mint,
        transfer.destination,
        transfer.amount.toString(),
      ],
    );
    if (!inserted.rows[0]) {
      await client.query("COMMIT");
      return;
    }
    const transferId = inserted.rows[0].id;
    const referenced = await client.query(
      `SELECT i.*, a.id AS attempt_id, a.asset AS attempt_asset, a.mint AS attempt_mint,
        a.recipient AS attempt_recipient,a.payable_units AS attempt_payable_units,a.base_units AS attempt_base_units,
        a.reference AS attempt_reference,a.activated_at
        FROM payment_attempts a JOIN invoices i ON i.id=a.invoice_id
        WHERE a.environment=$1 AND a.cluster=$2 AND a.reference=ANY($3::text[]) AND a.payment_enabled FOR UPDATE OF i`,
      [config.environment, config.cluster, transfer.references],
    );
    let invoice: Record<string, unknown> | undefined;
    let disposition = "unmatched";
    if (referenced.rows.length > 1) disposition = "ambiguous_reference";
    else if (referenced.rows[0]) {
      const candidate = referenced.rows[0];
      invoice = candidate;
      if (
        candidate.attempt_mint !== transfer.mint ||
        candidate.attempt_recipient !== config.recipient
      )
        disposition = "reference_conflict";
      else if (BigInt(candidate.attempt_payable_units) !== transfer.amount)
        disposition =
          transfer.amount < BigInt(candidate.attempt_payable_units)
            ? "partial"
            : "overpaid";
      else disposition = "match";
    } else {
      const matched = await client.query(
        `SELECT i.*,a.id AS attempt_id,a.asset AS attempt_asset,a.mint AS attempt_mint,
         a.recipient AS attempt_recipient,a.payable_units AS attempt_payable_units,a.base_units AS attempt_base_units,
         a.reference AS attempt_reference,a.activated_at
         FROM payment_attempts a JOIN invoices i ON i.id=a.invoice_id
         WHERE a.environment=$1 AND a.cluster=$2 AND a.mint=$3 AND a.recipient=$4 AND a.payable_units=$5 AND a.payment_enabled FOR UPDATE OF i`,
        [
          config.environment,
          config.cluster,
          transfer.mint,
          config.recipient,
          transfer.amount.toString(),
        ],
      );
      invoice = matched.rows[0];
      if (invoice) disposition = "match";
    }
    if (invoice && disposition === "match") {
      if (!invoice.activated_at) disposition = "inactive_attempt";
      else if (invoice.status === "paid") disposition = "duplicate_payment";
      else if (
        transfer.blockTime * 1000 <
        new Date(invoice.activated_at as string).getTime() - 1000
      )
        disposition = "predates_invoice";
      else if (
        transfer.blockTime * 1000 >
        new Date(invoice.expires_at as string).getTime()
      )
        disposition = "late";
      else {
        disposition = "paid";
        const updated = (
          await client.query(
            `UPDATE invoices SET status='paid',asset=$2,mint=$3,recipient=$4,reference=$5,base_units=$6,payable_units=$7,invoice_version=invoice_version+1 WHERE id=$1 RETURNING invoice_version`,
            [
              invoice.id,
              invoice.attempt_asset,
              invoice.attempt_mint,
              invoice.attempt_recipient,
              invoice.attempt_reference,
              invoice.attempt_base_units,
              invoice.attempt_payable_units,
            ],
          )
        ).rows[0];
        await client.query(
          "INSERT INTO ledger_entries(invoice_id,transfer_id,amount,asset,entry_type) VALUES($1,$2,$3,$4,'payment')",
          [invoice.id, transferId, transfer.amount.toString(), config.asset],
        );
        const eventId = randomUUID();
        const payload = {
          event_id: eventId,
          event_type: "payment.confirmed",
          schema_version: 1,
          occurred_at: new Date().toISOString(),
          project_id: invoice.project_id,
          data: {
            invoice_id: invoice.id,
            invoice_version: updated.invoice_version,
            attempt_id: invoice.attempt_id,
            transfer_id: String(transferId),
            invoice_status: "paid",
            recipient: invoice.attempt_recipient,
            order_id: invoice.order_id,
            cluster: config.cluster,
            mint: config.mint,
            asset: config.asset,
            amount_expected: formatAmount(
              BigInt(String(invoice.attempt_payable_units)),
            ),
            amount_received: formatAmount(transfer.amount),
            transfers: [
              {
                signature,
                instruction_path: transfer.path,
                slot: transfer.slot,
              },
            ],
            finality: "finalized",
          },
        };
        await client.query(
          "INSERT INTO webhook_events(event_id,invoice_id,event_type,payload) VALUES($1,$2,'payment.confirmed',$3)",
          [eventId, invoice.id, payload],
        );
        await client.query(
          "INSERT INTO audit_logs(project_id,action,entity_id) VALUES($1,'invoice.paid',$2)",
          [invoice.project_id, invoice.id],
        );
      }
    }
    if (invoice && disposition !== "paid") {
      const eventType =
        disposition === "partial"
          ? "payment.partial"
          : disposition === "overpaid"
            ? "payment.overpaid"
            : disposition === "late"
              ? "payment.late"
              : "payment.review_required";
      const updated = (
        await client.query(
          "UPDATE invoices SET invoice_version=invoice_version+1 WHERE id=$1 RETURNING invoice_version,status",
          [invoice.id],
        )
      ).rows[0];
      const eventId = randomUUID();
      const payload = {
        event_id: eventId,
        event_type: eventType,
        schema_version: 1,
        occurred_at: new Date().toISOString(),
        project_id: invoice.project_id,
        data: {
          invoice_id: invoice.id,
          invoice_version: updated.invoice_version,
          invoice_status: updated.status,
          attempt_id: invoice.attempt_id,
          transfer_id: String(transferId),
          reason: disposition,
          order_id: invoice.order_id,
          cluster: config.cluster,
          asset: invoice.attempt_asset,
          mint: invoice.attempt_mint,
          recipient: invoice.attempt_recipient,
          amount_expected: formatAmount(
            BigInt(String(invoice.attempt_payable_units)),
          ),
          amount_received: formatAmount(transfer.amount),
          received_asset: config.asset,
          received_mint: config.mint,
          received_recipient: config.recipient,
          transfers: [
            { signature, instruction_path: transfer.path, slot: transfer.slot },
          ],
          finality: "finalized",
        },
      };
      await client.query(
        "INSERT INTO webhook_events(event_id,invoice_id,event_type,payload)VALUES($1,$2,$3,$4)",
        [eventId, invoice.id, eventType, payload],
      );
    }
    await client.query(
      "UPDATE chain_transfers SET invoice_id=$1,disposition=$2,attempt_id=$4 WHERE id=$3",
      [
        invoice?.id ?? null,
        disposition,
        transferId,
        invoice?.attempt_id ?? null,
      ],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
