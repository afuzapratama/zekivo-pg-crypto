import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { formatAmount } from "../../domain/src/amount.js";
export function adminTransactionRoutes(
  app: FastifyInstance,
  pool: pg.Pool,
  scope: { APP_ENV: string; SOLANA_CLUSTER: string },
) {
  app.get<{
    Querystring: {
      before?: string;
      project_id?: string;
      asset?: string;
      disposition?: string;
      signature?: string;
      unassigned?: string;
    };
  }>(
    "/transactions",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            before: { type: "string", pattern: "^[0-9]{1,18}$" },
            project_id: { type: "string", format: "uuid" },
            asset: { type: "string", enum: ["USDT", "USDC"] },
            disposition: {
              type: "string",
              enum: [
                "paid",
                "unmatched",
                "partial",
                "overpaid",
                "late",
                "duplicate_payment",
                "ambiguous_reference",
                "reference_conflict",
                "inactive_attempt",
                "predates_invoice",
              ],
            },
            signature: {
              type: "string",
              minLength: 64,
              maxLength: 88,
              pattern: "^[1-9A-HJ-NP-Za-km-z]+$",
            },
            unassigned: { type: "string", enum: ["true"] },
          },
        },
      },
    },
    async (req, reply) => {
      if (req.query.project_id && req.query.unassigned)
        return reply.code(400).send({ error: "conflicting_filters" });
      const rows = (
        await pool.query(
          `SELECT t.id::text,t.cluster,t.signature,t.instruction_path,t.slot::text,t.block_time,t.created_at,t.mint,t.destination,t.amount::text,t.disposition,coalesce(c.asset,a.asset) AS asset,i.id AS invoice_id,i.order_id,i.status AS invoice_status,p.id AS project_id,p.name AS project_name,CASE WHEN t.disposition<>'paid' THEN coalesce(r.status,'open') END AS review_status
   FROM chain_transfers t LEFT JOIN invoices i ON i.id=t.invoice_id AND i.environment=t.environment AND i.cluster=t.cluster LEFT JOIN projects p ON p.id=i.project_id AND p.environment=t.environment LEFT JOIN token_configs c ON c.environment=t.environment AND c.cluster=t.cluster AND c.mint=t.mint AND c.token_account=t.destination LEFT JOIN payment_attempts a ON a.id=t.attempt_id AND a.environment=t.environment AND a.cluster=t.cluster AND a.mint=t.mint LEFT JOIN transfer_reviews r ON r.transfer_id=t.id
   WHERE t.environment=$1 AND t.cluster=$2 AND ($3::bigint IS NULL OR t.id<$3) AND ($4::uuid IS NULL OR p.id=$4) AND ($5::text IS NULL OR coalesce(c.asset,a.asset)=$5) AND ($6::text IS NULL OR t.disposition=$6) AND ($7::text IS NULL OR t.signature=$7) AND ($8::boolean IS NOT TRUE OR t.invoice_id IS NULL) ORDER BY t.id DESC LIMIT 26`,
          [
            scope.APP_ENV,
            scope.SOLANA_CLUSTER,
            req.query.before ?? null,
            req.query.project_id ?? null,
            req.query.asset ?? null,
            req.query.disposition ?? null,
            req.query.signature ?? null,
            req.query.unassigned ?? null,
          ],
        )
      ).rows;
      return {
        items: rows
          .slice(0, 25)
          .map((t) => ({ ...t, amount: formatAmount(BigInt(t.amount)) })),
        next_cursor: rows.length > 25 ? rows[24]!.id : null,
      };
    },
  );
}
