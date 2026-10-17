import Fastify from "fastify";
import { createHash } from "node:crypto";
import { z } from "zod";
import type pg from "pg";
import { verifyWebhook } from "../../../packages/webhooks/src/crypto.js";
const payloadSchema = z.object({
  event_id: z.uuid(),
  project_id: z.uuid(),
  event_type: z.enum([
    "payment.confirmed",
    "payment.expired",
    "payment.partial",
    "payment.overpaid",
    "payment.late",
    "payment.review_required",
  ]),
  schema_version: z.literal(1),
  occurred_at: z.iso.datetime(),
  data: z.object({
    invoice_id: z.uuid(),
    invoice_version: z.number().int().positive(),
    order_id: z.string().min(1).max(128),
    finality: z.string().optional(),
  }),
});
export function buildReceiver(
  pool: pg.Pool,
  config: {
    APP_ENV: string;
    secret: string;
    controlToken: string;
    projectId: string;
  },
) {
  if (config.APP_ENV !== "local" && config.APP_ENV !== "test")
    throw new Error("Demo receiver is sandbox only");
  const app = Fastify({ bodyLimit: 65536, logger: false });
  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (_req, body, done) => done(null, body),
  );
  let fault: {
    mode: "none" | "before_commit" | "after_commit" | "timeout_after_commit";
    remaining: number;
  } = { mode: "none", remaining: 0 };
  app.get("/health", async () => ({
    status: "ok",
    service: "local-webhook-receiver",
  }));
  app.post<{ Body: string }>("/webhooks/zekivo", async (req, reply) => {
    if (
      !verifyWebhook(
        req.body,
        config.secret,
        typeof req.headers["zekivo-timestamp"] === "string"
          ? req.headers["zekivo-timestamp"]
          : undefined,
        typeof req.headers["zekivo-signature"] === "string"
          ? req.headers["zekivo-signature"]
          : undefined,
      )
    )
      return reply.code(401).send({ error: "invalid_signature" });
    let payload: z.infer<typeof payloadSchema>;
    try {
      payload = payloadSchema.parse(JSON.parse(req.body));
    } catch {
      return reply.code(400).send({ error: "invalid_payload" });
    }
    if (payload.project_id !== config.projectId)
      return reply.code(403).send({ error: "wrong_project" });
    if (
      payload.event_type === "payment.confirmed" &&
      payload.data.finality !== "finalized"
    )
      return reply.code(400).send({ error: "not_finalized" });
    const mode = fault.remaining > 0 ? fault.mode : "none";
    if (fault.remaining > 0) fault.remaining--;
    if (mode === "before_commit")
      return reply.code(503).send({ error: "simulated_failure" });
    const hash = createHash("sha256").update(req.body).digest("hex"),
      client = await pool.connect();
    let duplicate = false;
    try {
      await client.query("BEGIN");
      const inserted = await client.query(
        "INSERT INTO demo_webhook_receipts(event_id,project_id,invoice_id,payload_hash,payload) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING event_id",
        [
          payload.event_id,
          payload.project_id,
          payload.data.invoice_id,
          hash,
          JSON.parse(req.body),
        ],
      );
      duplicate = !inserted.rowCount;
      if (duplicate) {
        const old = (
          await client.query(
            "SELECT payload_hash FROM demo_webhook_receipts WHERE event_id=$1",
            [payload.event_id],
          )
        ).rows[0];
        if (old.payload_hash !== hash) {
          await client.query("ROLLBACK");
          return reply.code(409).send({ error: "event_payload_conflict" });
        }
      } else {
        const paid = payload.event_type === "payment.confirmed";
        const orderResult = await client.query(
          `INSERT INTO demo_merchant_orders(project_id,order_id,invoice_id,last_version,status,fulfillment_count) VALUES($1,$2,$3,$4,$5,$6)
     ON CONFLICT(project_id,order_id) DO UPDATE SET last_version=greatest(demo_merchant_orders.last_version,excluded.last_version),
     status=CASE WHEN demo_merchant_orders.status='paid' THEN 'paid' WHEN excluded.status='paid' THEN 'paid' WHEN excluded.status='pending' THEN demo_merchant_orders.status WHEN excluded.last_version>demo_merchant_orders.last_version THEN excluded.status ELSE demo_merchant_orders.status END,
     fulfillment_count=CASE WHEN demo_merchant_orders.fulfillment_count=1 OR excluded.status='paid' THEN 1 ELSE 0 END
     WHERE demo_merchant_orders.invoice_id=excluded.invoice_id`,
          [
            payload.project_id,
            payload.data.order_id,
            payload.data.invoice_id,
            payload.data.invoice_version,
            paid
              ? "paid"
              : payload.event_type === "payment.expired"
                ? "expired"
                : "pending",
            paid ? 1 : 0,
          ],
        );
        if (orderResult.rowCount !== 1) {
          await client.query("ROLLBACK");
          return reply.code(409).send({ error: "order_invoice_conflict" });
        }
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    if (mode === "timeout_after_commit")
      await new Promise((resolve) => setTimeout(resolve, 11000));
    if (mode === "after_commit")
      return reply.code(503).send({ error: "simulated_ack_failure" });
    return { received: true, duplicate };
  });
  app.register(
    async (test) => {
      test.addHook("preHandler", async (req, reply) => {
        if (req.headers.authorization !== `Bearer ${config.controlToken}`)
          return reply.code(401).send({ error: "unauthorized" });
      });
      test.post<{ Body: string }>("/control", async (req, reply) => {
        const schema = z.object({
          mode: z.enum([
            "none",
            "before_commit",
            "after_commit",
            "timeout_after_commit",
          ]),
          remaining: z.number().int().min(0).max(10),
        });
        let parsed;
        try {
          parsed = schema.parse(JSON.parse(req.body));
        } catch {
          return reply.code(400).send({ error: "invalid_control" });
        }
        fault = parsed;
        return { configured: true };
      });
      test.get<{ Querystring: { invoice_id?: string } }>(
        "/inbox",
        async (req, reply) => {
          if (
            req.query.invoice_id &&
            !z.uuid().safeParse(req.query.invoice_id).success
          )
            return reply.code(400).send({ error: "invalid_invoice_id" });
          const receipts = (
            await pool.query(
              "SELECT event_id,invoice_id,payload,signature_verified,received_at FROM demo_webhook_receipts WHERE project_id=$1 AND ($2::uuid IS NULL OR invoice_id=$2) ORDER BY received_at DESC LIMIT 50",
              [config.projectId, req.query.invoice_id ?? null],
            )
          ).rows;
          const orders = (
            await pool.query(
              "SELECT order_id,invoice_id,status,fulfillment_count,last_version FROM demo_merchant_orders WHERE project_id=$1 AND ($2::uuid IS NULL OR invoice_id=$2) LIMIT 50",
              [config.projectId, req.query.invoice_id ?? null],
            )
          ).rows;
          return { receipts, orders };
        },
      );
    },
    { prefix: "/test" },
  );
  return app;
}
