import { randomBytes, randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { encryptSecret } from "./crypto.js";
import { resolveTarget } from "./transport.js";
import { replayDelivery } from "./queue.js";
export function webhookRoutes(
  app: FastifyInstance,
  pool: pg.Pool,
  config: { APP_ENV: string; WEBHOOK_ENCRYPTION_KEY?: string },
) {
  const params = {
    type: "object",
    required: ["id"],
    properties: { id: { type: "string", format: "uuid" } },
  };
  const project = (req: unknown) => (req as { projectId: string }).projectId;
  app.post<{ Body: { url: string } }>(
    "/webhook-endpoints",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["url"],
          properties: { url: { type: "string", maxLength: 2048 } },
        },
      },
    },
    async (req, reply) => {
      if (!config.WEBHOOK_ENCRYPTION_KEY)
        return reply.code(503).send({ error: "webhooks_not_configured" });
      try {
        await resolveTarget(
          { url: req.body.url, kind: "external" },
          config.APP_ENV,
        );
      } catch {
        return reply.code(400).send({ error: "invalid_webhook_target" });
      }
      const secret = `whsec_${randomBytes(32).toString("hex")}`,
        id = randomUUID();
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          "INSERT INTO webhook_endpoints(id,project_id,url,kind,secret_ciphertext) VALUES($1,$2,$3,'external',$4)",
          [
            id,
            project(req),
            new URL(req.body.url).href,
            encryptSecret(secret, config.WEBHOOK_ENCRYPTION_KEY),
          ],
        );
        await client.query(
          "INSERT INTO audit_logs(project_id,action,entity_id) VALUES($1,'webhook.endpoint_created',$2)",
          [project(req), id],
        );
        await client.query("COMMIT");
        return reply.code(201).send({
          id,
          url: new URL(req.body.url).href,
          signing_secret: secret,
        });
      } catch (error) {
        await client.query("ROLLBACK");
        if ((error as { code?: string }).code === "23505")
          return reply.code(409).send({ error: "endpoint_exists" });
        throw error;
      } finally {
        client.release();
      }
    },
  );
  app.get("/webhook-endpoints", async (req) => ({
    items: (
      await pool.query(
        "SELECT id,url,kind,active,created_at FROM webhook_endpoints WHERE project_id=$1 ORDER BY created_at DESC LIMIT 100",
        [project(req)],
      )
    ).rows,
  }));
  app.post<{ Params: { id: string } }>(
    "/webhook-endpoints/:id/rotate-secret",
    { schema: { params } },
    async (req, reply) => {
      if (!config.WEBHOOK_ENCRYPTION_KEY)
        return reply.code(503).send({ error: "webhooks_not_configured" });
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const endpoint = (
          await client.query(
            "SELECT kind FROM webhook_endpoints WHERE id=$1 AND project_id=$2 FOR UPDATE",
            [req.params.id, project(req)],
          )
        ).rows[0];
        if (!endpoint) {
          await client.query("COMMIT");
          return reply.code(404).send({ error: "not_found" });
        }
        if (endpoint.kind === "local_inbox") {
          await client.query("COMMIT");
          return reply.code(409).send({ error: "local_fixture_secret_fixed" });
        }
        const secret = `whsec_${randomBytes(32).toString("hex")}`;
        await client.query(
          "UPDATE webhook_endpoints SET secret_ciphertext=$2 WHERE id=$1",
          [req.params.id, encryptSecret(secret, config.WEBHOOK_ENCRYPTION_KEY)],
        );
        await client.query(
          "INSERT INTO audit_logs(project_id,action,entity_id) VALUES($1,'webhook.secret_rotated',$2)",
          [project(req), req.params.id],
        );
        await client.query("COMMIT");
        return { id: req.params.id, signing_secret: secret };
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
  );
  app.get<{
    Querystring: { invoice_id?: string; before?: string; limit?: number };
  }>(
    "/webhook-deliveries",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            invoice_id: { type: "string", format: "uuid" },
            before: { type: "string", pattern: "^[0-9]{1,18}$" },
            limit: { type: "integer", minimum: 1, maximum: 100, default: 25 },
          },
        },
      },
    },
    async (req) => {
      const items = (
        await pool.query(
          `SELECT d.id,d.event_id,d.endpoint_id,d.status,d.attempt_count,d.replay_count,d.next_attempt_at,d.last_http_status,d.last_error,d.delivered_at FROM webhook_deliveries d JOIN webhook_endpoints h ON h.id=d.endpoint_id JOIN webhook_events e ON e.event_id=d.event_id WHERE h.project_id=$1 AND ($2::uuid IS NULL OR e.invoice_id=$2) AND ($3::bigint IS NULL OR d.id<$3) ORDER BY d.id DESC LIMIT $4`,
          [
            project(req),
            req.query.invoice_id ?? null,
            req.query.before ?? null,
            req.query.limit ?? 25,
          ],
        )
      ).rows;
      return {
        items,
        next_cursor:
          items.length === (req.query.limit ?? 25) ? items.at(-1)?.id : null,
      };
    },
  );
  const deliveryParams = {
    type: "object",
    required: ["id"],
    properties: { id: { type: "string", pattern: "^[0-9]{1,18}$" } },
  };
  app.get<{ Params: { id: string } }>(
    "/webhook-deliveries/:id/attempts",
    { schema: { params: deliveryParams } },
    async (req, reply) => {
      const owned = (
        await pool.query(
          "SELECT 1 FROM webhook_deliveries d JOIN webhook_endpoints h ON h.id=d.endpoint_id WHERE d.id=$1 AND h.project_id=$2",
          [req.params.id, project(req)],
        )
      ).rowCount;
      if (!owned) return reply.code(404).send({ error: "not_found" });
      return {
        items: (
          await pool.query(
            "SELECT attempt_no,started_at,finished_at,http_status,error_code FROM webhook_attempts WHERE delivery_id=$1 ORDER BY attempt_no DESC LIMIT 100",
            [req.params.id],
          )
        ).rows,
      };
    },
  );
  app.post<{ Params: { id: string } }>(
    "/webhook-deliveries/:id/replay",
    { schema: { params: deliveryParams } },
    async (req, reply) => {
      const result = await replayDelivery(pool, project(req), req.params.id);
      if (result === "not_found")
        return reply.code(404).send({ error: "not_found" });
      if (result === "busy")
        return reply.code(409).send({ error: "delivery_inflight" });
      return { status: result };
    },
  );
}
