import { createHash, randomUUID } from "node:crypto";
import { address } from "@solana/kit";
import type { FastifyInstance } from "fastify";
import type pg from "pg";
import type { adminAuthRoutes } from "./routes.js";
import { parseAmount, formatAmount } from "../../domain/src/amount.js";
import { SolanaRpc } from "../../solana/src/rpc.js";
import type { TokenConfig } from "../../solana/src/decode.js";
import { verifyRefund, RefundProofMismatch } from "../../solana/src/refund.js";
const params = {
  type: "object",
  required: ["id"],
  properties: { id: { type: "string", format: "uuid" } },
};
export function adminRefundRoutes(
  app: FastifyInstance,
  pool: pg.Pool,
  scope: { APP_ENV: string; SOLANA_CLUSTER: string; SOLANA_RPC_URL?: string },
  access: ReturnType<typeof adminAuthRoutes>,
) {
  const env = [scope.APP_ENV, scope.SOLANA_CLUSTER];
  app.get<{ Params: { id: string }; Querystring: { before?: string } }>(
    "/invoices/:id/refunds",
    {
      schema: {
        params,
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: { before: { type: "string", format: "uuid" } },
        },
      },
    },
    async (req, reply) => {
      const invoice = (
        await pool.query(
          "SELECT id FROM invoices WHERE id=$1 AND environment=$2 AND cluster=$3",
          [req.params.id, ...env],
        )
      ).rows[0];
      if (!invoice) return reply.code(404).send({ error: "not_found" });
      if (
        req.query.before &&
        !(
          await pool.query(
            "SELECT 1 FROM manual_refunds WHERE id=$1 AND invoice_id=$2",
            [req.query.before, invoice.id],
          )
        ).rowCount
      )
        return reply.code(400).send({ error: "invalid_cursor" });
      const rows = (
        await pool.query(
          "SELECT id,asset,mint,source_account,destination,destination_account,amount::text,signature,instruction_path,slot::text,block_time,reason,destination_verification,tenant_id,object_id,verified_at FROM manual_refunds WHERE invoice_id=$1 AND ($2::uuid IS NULL OR (verified_at,id)<(SELECT verified_at,id FROM manual_refunds WHERE id=$2 AND invoice_id=$1)) ORDER BY verified_at DESC,id DESC LIMIT 26",
          [invoice.id, req.query.before ?? null],
        )
      ).rows;
      const totals = (
        await pool.query(
          "SELECT asset,sum(amount)::text AS amount FROM manual_refunds WHERE invoice_id=$1 GROUP BY asset",
          [invoice.id],
        )
      ).rows;
      return {
        items: rows
          .slice(0, 25)
          .map((r) => ({ ...r, amount: formatAmount(BigInt(r.amount)) })),
        totals: totals.map((r) => ({
          ...r,
          amount: formatAmount(BigInt(r.amount)),
        })),
        next_cursor: rows.length > 25 ? rows[24].id : null,
      };
    },
  );
  app.post<{
    Params: { id: string };
    Body: {
      asset: string;
      amount: string;
      destination: string;
      signature: string;
      instruction_path: string;
      reason: string;
      destination_verification: string;
      destination_confirmed: boolean;
    };
  }>(
    "/invoices/:id/refunds",
    {
      schema: {
        params,
        headers: {
          type: "object",
          required: ["idempotency-key"],
          properties: { "idempotency-key": { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: [
            "asset",
            "amount",
            "destination",
            "signature",
            "instruction_path",
            "reason",
            "destination_verification",
            "destination_confirmed",
          ],
          properties: {
            asset: { type: "string", enum: ["USDT", "USDC"] },
            amount: {
              type: "string",
              pattern: "^(0|[1-9][0-9]{0,9})(\\.[0-9]{1,6})?$",
            },
            destination: { type: "string", minLength: 32, maxLength: 44 },
            signature: {
              type: "string",
              pattern: "^[1-9A-HJ-NP-Za-km-z]{64,88}$",
            },
            instruction_path: {
              type: "string",
              pattern: "^(0|[1-9][0-9]{0,3})(\\.(0|[1-9][0-9]{0,3}))?$",
            },
            reason: { type: "string", minLength: 10, maxLength: 2000 },
            destination_verification: {
              type: "string",
              minLength: 10,
              maxLength: 1000,
            },
            destination_confirmed: { type: "boolean", const: true },
          },
        },
      },
    },
    async (req, reply) => {
      const actor = await access.authorizeWrite(req, reply, "refund:write");
      if (!actor) return reply;
      let amount: bigint;
      try {
        amount = parseAmount(req.body.amount);
        address(req.body.destination);
      } catch {
        return reply.code(400).send({ error: "invalid_refund" });
      }
      const body = {
        ...req.body,
        amount: amount.toString(),
        reason: req.body.reason.trim(),
        destination_verification: req.body.destination_verification.trim(),
      };
      if (body.reason.length < 10 || body.destination_verification.length < 10)
        return reply.code(400).send({ error: "invalid_refund" });
      const hash = createHash("sha256")
        .update(JSON.stringify({ invoice: req.params.id, ...body }))
        .digest("hex");
      const requestId = req.headers["idempotency-key"] as string;
      const prior = async () =>
        (
          await pool.query(
            "SELECT id,request_hash FROM manual_refunds WHERE environment=$1 AND cluster=$2 AND object_id=$3 AND request_id=$4",
            [...env, actor.object_id, requestId],
          )
        ).rows[0];
      const previous = await prior();
      if (previous)
        return previous.request_hash === hash
          ? { id: previous.id, status: "confirmed", replayed: true }
          : reply.code(409).send({ error: "idempotency_conflict" });
      const invoice = (
        await pool.query(
          "SELECT id,project_id,status,created_at FROM invoices WHERE id=$1 AND environment=$2 AND cluster=$3",
          [req.params.id, ...env],
        )
      ).rows[0];
      if (!invoice) return reply.code(404).send({ error: "not_found" });
      if (invoice.status !== "paid")
        return reply.code(409).send({ error: "refund_requires_paid_invoice" });
      const config = (
        await pool.query<TokenConfig>(
          "SELECT * FROM token_configs WHERE environment=$1 AND cluster=$2 AND asset=$3",
          [...env, body.asset],
        )
      ).rows[0];
      if (!config || !scope.SOLANA_RPC_URL)
        return reply
          .code(503)
          .send({ error: "refund_verification_unavailable" });
      let proof: Awaited<ReturnType<typeof verifyRefund>>;
      try {
        proof = await verifyRefund(
          new SolanaRpc(scope.SOLANA_RPC_URL, { retries: 0 }),
          config,
          {
            destination: body.destination,
            amount,
            signature: body.signature,
            path: body.instruction_path,
            createdAt: new Date(invoice.created_at),
          },
        );
      } catch (error) {
        return reply
          .code(error instanceof RefundProofMismatch ? 422 : 503)
          .send({
            error:
              error instanceof RefundProofMismatch
                ? "refund_proof_mismatch"
                : "refund_verification_unavailable",
          });
      }
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT id FROM invoices WHERE id=$1 FOR UPDATE", [
          invoice.id,
        ]);
        const replay = (
          await client.query(
            "SELECT id,request_hash FROM manual_refunds WHERE environment=$1 AND cluster=$2 AND object_id=$3 AND request_id=$4",
            [...env, actor.object_id, requestId],
          )
        ).rows[0];
        if (replay) {
          await client.query("COMMIT");
          return replay.request_hash === hash
            ? { id: replay.id, status: "confirmed", replayed: true }
            : reply.code(409).send({ error: "idempotency_conflict" });
        }
        const paid = (
          await client.query(
            "SELECT coalesce(sum(amount),0)::text AS amount FROM ledger_entries WHERE invoice_id=$1 AND asset=$2 AND entry_type='payment'",
            [invoice.id, body.asset],
          )
        ).rows[0];
        const refunded = (
          await client.query(
            "SELECT coalesce(sum(amount),0)::text AS amount FROM manual_refunds WHERE invoice_id=$1 AND asset=$2",
            [invoice.id, body.asset],
          )
        ).rows[0];
        if (BigInt(refunded.amount) + amount > BigInt(paid.amount)) {
          await client.query("ROLLBACK");
          return reply.code(409).send({ error: "refund_exceeds_payment" });
        }
        const id = randomUUID();
        await client.query(
          "INSERT INTO manual_refunds(id,invoice_id,environment,cluster,asset,mint,source_account,destination,destination_account,amount,signature,instruction_path,slot,block_time,reason,destination_verification,tenant_id,object_id,request_id,request_hash)VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)",
          [
            id,
            invoice.id,
            ...env,
            body.asset,
            config.mint,
            config.token_account,
            body.destination,
            proof.destination_account,
            amount.toString(),
            body.signature,
            body.instruction_path,
            proof.slot,
            proof.block_time,
            body.reason,
            body.destination_verification,
            actor.tenant_id,
            actor.object_id,
            requestId,
            hash,
          ],
        );
        await client.query(
          "INSERT INTO admin_audit_logs(environment,cluster,tenant_id,object_id,action,project_id,entity_id)VALUES($1,$2,$3,$4,'refund.confirmed',$5,$6)",
          [...env, actor.tenant_id, actor.object_id, invoice.project_id, id],
        );
        await client.query("COMMIT");
        return reply.code(201).send({ id, status: "confirmed" });
      } catch (error) {
        await client.query("ROLLBACK");
        if ((error as { code?: string }).code === "23505") {
          const prior = (
            await client.query(
              "SELECT id,request_hash FROM manual_refunds WHERE environment=$1 AND cluster=$2 AND object_id=$3 AND request_id=$4",
              [...env, actor.object_id, requestId],
            )
          ).rows[0];
          if (prior)
            return prior.request_hash === hash
              ? { id: prior.id, status: "confirmed", replayed: true }
              : reply.code(409).send({ error: "idempotency_conflict" });
          return reply.code(409).send({ error: "refund_proof_already_used" });
        }
        throw error;
      } finally {
        client.release();
      }
    },
  );
}
