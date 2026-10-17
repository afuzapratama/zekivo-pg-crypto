import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type pg from "pg";
import type { adminAuthRoutes } from "./routes.js";
import { formatAmount } from "../../domain/src/amount.js";
const numeric = { type: "string", pattern: "^[0-9]{1,18}$" };
const statuses = ["open", "in_progress", "closed"];
const dispositions = [
  "unmatched",
  "partial",
  "overpaid",
  "late",
  "duplicate_payment",
  "ambiguous_reference",
  "reference_conflict",
  "inactive_attempt",
  "predates_invoice",
];
export function adminReviewRoutes(
  app: FastifyInstance,
  pool: pg.Pool,
  scope: { APP_ENV: string; SOLANA_CLUSTER: string },
  access: ReturnType<typeof adminAuthRoutes>,
) {
  const env = [scope.APP_ENV, scope.SOLANA_CLUSTER];
  const from = `FROM chain_transfers t LEFT JOIN invoices i ON i.id=t.invoice_id AND i.environment=t.environment AND i.cluster=t.cluster LEFT JOIN projects p ON p.id=i.project_id AND p.environment=t.environment LEFT JOIN token_configs c ON c.environment=t.environment AND c.cluster=t.cluster AND c.mint=t.mint AND c.token_account=t.destination LEFT JOIN transfer_reviews r ON r.transfer_id=t.id`;
  const fields = `t.id::text,t.signature,t.instruction_path,t.slot::text,t.block_time,t.mint,t.destination,t.amount::text,t.disposition,i.id AS invoice_id,i.project_id,p.name AS project_name,i.order_id,c.asset,coalesce(r.status,'open') AS review_status,coalesce(r.version,0) AS review_version,r.updated_at`;
  const serialize = (row: Record<string, unknown>) => ({
    ...row,
    amount: formatAmount(BigInt(row.amount as string)),
  });
  const paramSchema = {
    type: "object",
    required: ["id"],
    properties: { id: numeric },
  };
  app.get<{
    Querystring: {
      before?: string;
      status?: string;
      disposition?: string;
      project_id?: string;
      asset?: string;
    };
  }>(
    "/reviews",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            before: numeric,
            status: {
              type: "string",
              enum: ["active", "all", ...statuses],
              default: "active",
            },
            disposition: { type: "string", enum: dispositions },
            project_id: { type: "string", format: "uuid" },
            asset: { type: "string", enum: ["USDT", "USDC"] },
          },
        },
      },
    },
    async (req) => {
      const rows = (
        await pool.query(
          `SELECT ${fields} ${from} WHERE t.environment=$1 AND t.cluster=$2 AND t.disposition<>'paid' AND ($3::bigint IS NULL OR t.id<$3) AND ($4='all' OR ($4='active' AND coalesce(r.status,'open')<>'closed') OR coalesce(r.status,'open')=$4) AND ($5::text IS NULL OR t.disposition=$5) AND ($6::uuid IS NULL OR p.id=$6) AND ($7::text IS NULL OR c.asset=$7) ORDER BY t.id DESC LIMIT 26`,
          [
            ...env,
            req.query.before ?? null,
            req.query.status ?? "active",
            req.query.disposition ?? null,
            req.query.project_id ?? null,
            req.query.asset ?? null,
          ],
        )
      ).rows;
      return {
        items: rows.slice(0, 25).map(serialize),
        next_cursor: rows.length > 25 ? rows[24]!.id : null,
      };
    },
  );
  app.get<{ Params: { id: string }; Querystring: { before_note?: string } }>(
    "/reviews/:id",
    {
      schema: {
        params: paramSchema,
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: { before_note: numeric },
        },
      },
    },
    async (req, reply) => {
      const row = (
        await pool.query(
          `SELECT ${fields} ${from} WHERE t.id=$3 AND t.environment=$1 AND t.cluster=$2 AND t.disposition<>'paid'`,
          [...env, req.params.id],
        )
      ).rows[0];
      if (!row) return reply.code(404).send({ error: "not_found" });
      const notes = (
        await pool.query(
          "SELECT id::text,tenant_id,object_id,from_status,to_status,version,reason,created_at FROM transfer_review_actions WHERE transfer_id=$1 AND environment=$2 AND cluster=$3 AND ($4::bigint IS NULL OR id<$4) ORDER BY transfer_review_actions.id DESC LIMIT 26",
          [req.params.id, ...env, req.query.before_note ?? null],
        )
      ).rows;
      return {
        transfer: serialize(row),
        notes: notes.slice(0, 25),
        next_note_cursor: notes.length > 25 ? notes[24]!.id : null,
      };
    },
  );
  app.post<{
    Params: { id: string };
    Body: { status: string; reason: string; expected_version: number };
  }>(
    "/reviews/:id",
    {
      schema: {
        params: paramSchema,
        headers: {
          type: "object",
          required: ["idempotency-key"],
          properties: { "idempotency-key": { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: ["status", "reason", "expected_version"],
          properties: {
            status: { type: "string", enum: statuses },
            reason: {
              type: "string",
              minLength: 10,
              maxLength: 2000,
              pattern: "\\S",
            },
            expected_version: {
              type: "integer",
              minimum: 0,
              maximum: 2147483646,
            },
          },
        },
      },
    },
    async (req, reply) => {
      const actor = await access.authorizeWrite(req, reply, "review:write");
      if (!actor) return reply;
      const reason = req.body.reason.trim();
      if (reason.length < 10)
        return reply.code(400).send({ error: "reason_too_short" });
      const hash = createHash("sha256")
        .update(JSON.stringify({ id: req.params.id, ...req.body, reason }))
        .digest("hex");
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        // Serialize first action as well as updates; never change chain matching or ledger state.
        const transfer = (
          await client.query(
            "SELECT t.id,i.project_id FROM chain_transfers t LEFT JOIN invoices i ON i.id=t.invoice_id AND i.environment=t.environment AND i.cluster=t.cluster WHERE t.id=$3 AND t.environment=$1 AND t.cluster=$2 AND t.disposition<>'paid' FOR UPDATE OF t",
            [...env, req.params.id],
          )
        ).rows[0];
        if (!transfer) {
          await client.query("ROLLBACK");
          return reply.code(404).send({ error: "not_found" });
        }
        const prior = (
          await client.query(
            "SELECT request_hash,version,to_status FROM transfer_review_actions WHERE environment=$1 AND cluster=$2 AND object_id=$3 AND request_id=$4",
            [...env, actor.object_id, req.headers["idempotency-key"]],
          )
        ).rows[0];
        if (prior) {
          await client.query("COMMIT");
          return prior.request_hash === hash
            ? {
                status: prior.to_status,
                version: prior.version,
                replayed: true,
              }
            : reply.code(409).send({ error: "idempotency_conflict" });
        }
        const current = (
          await client.query(
            "SELECT status,version FROM transfer_reviews WHERE transfer_id=$1 FOR UPDATE",
            [req.params.id],
          )
        ).rows[0] ?? { status: "open", version: 0 };
        if (current.version !== req.body.expected_version) {
          await client.query("ROLLBACK");
          return reply.code(409).send({ error: "review_changed" });
        }
        const version = current.version + 1;
        await client.query(
          "INSERT INTO transfer_reviews(transfer_id,status,version)VALUES($1,$2,$3)ON CONFLICT(transfer_id)DO UPDATE SET status=excluded.status,version=excluded.version,updated_at=now()",
          [req.params.id, req.body.status, version],
        );
        await client.query(
          "INSERT INTO transfer_review_actions(transfer_id,environment,cluster,tenant_id,object_id,request_id,request_hash,from_status,to_status,version,reason)VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
          [
            req.params.id,
            ...env,
            actor.tenant_id,
            actor.object_id,
            req.headers["idempotency-key"],
            hash,
            current.status,
            req.body.status,
            version,
            reason,
          ],
        );
        await client.query(
          "INSERT INTO admin_audit_logs(environment,cluster,tenant_id,object_id,action,project_id,entity_id)VALUES($1,$2,$3,$4,'transfer.reviewed',$5,$6)",
          [
            ...env,
            actor.tenant_id,
            actor.object_id,
            transfer.project_id,
            req.params.id,
          ],
        );
        await client.query("COMMIT");
        return { status: req.body.status, version };
      } catch (error) {
        await client.query("ROLLBACK");
        if ((error as { code?: string }).code === "23505")
          return reply.code(409).send({ error: "idempotency_conflict" });
        throw error;
      } finally {
        client.release();
      }
    },
  );
}
