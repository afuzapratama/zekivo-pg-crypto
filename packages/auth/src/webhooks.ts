import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type pg from "pg";
import type { adminAuthRoutes } from "./routes.js";
import { encryptSecret } from "../../webhooks/src/crypto.js";
import { resolveTarget } from "../../webhooks/src/transport.js";

export function adminWebhookRoutes(
  app: FastifyInstance,
  pool: pg.Pool,
  scope: {
    APP_ENV: string;
    SOLANA_CLUSTER: string;
    WEBHOOK_ENCRYPTION_KEY?: string;
    WEBHOOK_DELIVERY?: string;
  },
  access: ReturnType<typeof adminAuthRoutes>,
) {
  const base = "/projects/:projectId";
  const uuid = { type: "string", format: "uuid" };
  const numeric = { type: "string", pattern: "^[0-9]{1,18}$" };
  const params = (extra: Record<string, unknown> = {}) => ({
    type: "object",
    required: ["projectId", ...Object.keys(extra)],
    properties: { projectId: uuid, ...extra },
  });
  const owned = async (id: string) =>
    Boolean(
      (
        await pool.query(
          "SELECT 1 FROM projects WHERE id=$1 AND environment=$2",
          [id, scope.APP_ENV],
        )
      ).rowCount,
    );
  app.get<{ Params: { projectId: string }; Querystring: { before?: string } }>(
    `${base}/webhooks`,
    {
      schema: {
        params: params(),
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: { before: numeric },
        },
      },
    },
    async (req, reply) => {
      if (!(await owned(req.params.projectId)))
        return reply.code(404).send({ error: "not_found" });
      const [endpoints, deliveries] = await Promise.all([
        pool.query(
          "SELECT id,url,kind,active,created_at FROM webhook_endpoints WHERE project_id=$1 ORDER BY created_at DESC,id DESC LIMIT 101",
          [req.params.projectId],
        ),
        pool.query(
          `SELECT d.id::text,d.event_id,d.endpoint_id,h.url,e.invoice_id,e.event_type,d.status,d.attempt_count,d.replay_count,d.last_http_status,d.last_error,d.next_attempt_at,d.delivered_at FROM webhook_deliveries d JOIN webhook_endpoints h ON h.id=d.endpoint_id JOIN webhook_events e ON e.event_id=d.event_id JOIN invoices i ON i.id=e.invoice_id WHERE h.project_id=$1 AND i.project_id=$1 AND i.environment=$2 AND i.cluster=$3 AND ($4::bigint IS NULL OR d.id<$4) ORDER BY d.id DESC LIMIT 26`,
          [
            req.params.projectId,
            scope.APP_ENV,
            scope.SOLANA_CLUSTER,
            req.query.before ?? null,
          ],
        ),
      ]);
      return {
        configured: Boolean(scope.WEBHOOK_ENCRYPTION_KEY),
        delivery_enabled: scope.WEBHOOK_DELIVERY === "true",
        endpoints: endpoints.rows.slice(0, 100),
        has_more_endpoints: endpoints.rows.length > 100,
        deliveries: deliveries.rows.slice(0, 25),
        next_cursor:
          deliveries.rows.length > 25 ? deliveries.rows[24]!.id : null,
      };
    },
  );
  app.get<{ Params: { projectId: string; id: string } }>(
    `${base}/webhook-deliveries/:id/attempts`,
    { schema: { params: params({ id: numeric }) } },
    async (req, reply) => {
      const row = await pool.query(
        `SELECT 1 FROM webhook_deliveries d JOIN webhook_endpoints h ON h.id=d.endpoint_id JOIN projects p ON p.id=h.project_id JOIN webhook_events e ON e.event_id=d.event_id JOIN invoices i ON i.id=e.invoice_id WHERE d.id=$1 AND h.project_id=$2 AND i.project_id=$2 AND p.environment=$3 AND i.environment=$3 AND i.cluster=$4`,
        [
          req.params.id,
          req.params.projectId,
          scope.APP_ENV,
          scope.SOLANA_CLUSTER,
        ],
      );
      if (!row.rowCount) return reply.code(404).send({ error: "not_found" });
      return {
        items: (
          await pool.query(
            "SELECT attempt_no,started_at,finished_at,http_status,error_code FROM webhook_attempts WHERE delivery_id=$1 ORDER BY attempt_no DESC LIMIT 101",
            [req.params.id],
          )
        ).rows,
      };
    },
  );
  for (const action of ["create", "rotate", "replay"] as const) {
    app.post<{
      Params: { projectId: string; id?: string };
      Body: { url?: string };
    }>(
      action === "create"
        ? `${base}/webhook-endpoints`
        : action === "rotate"
          ? `${base}/webhook-endpoints/:id/rotate-secret`
          : `${base}/webhook-deliveries/:id/replay`,
      {
        schema: {
          params: params(
            action === "create"
              ? {}
              : { id: action === "rotate" ? uuid : numeric },
          ),
          headers: {
            type: "object",
            required: ["idempotency-key"],
            properties: { "idempotency-key": uuid },
          },
          body: {
            type: "object",
            additionalProperties: false,
            ...(action === "create"
              ? {
                  required: ["url"],
                  properties: {
                    url: { type: "string", minLength: 1, maxLength: 2048 },
                  },
                }
              : { properties: {} }),
          },
        },
      },
      async (req, reply) => {
        const actor = await access.authorizeWrite(
          req,
          reply,
          action === "replay" ? "webhook:replay" : "project:manage",
        );
        if (!actor) return reply;
        if (!(await owned(req.params.projectId)))
          return reply.code(404).send({ error: "not_found" });
        if (action !== "replay" && !scope.WEBHOOK_ENCRYPTION_KEY)
          return reply.code(503).send({ error: "webhooks_not_configured" });
        let url: string | undefined;
        if (action === "create") {
          try {
            await resolveTarget(
              { url: req.body.url!, kind: "external" },
              scope.APP_ENV,
            );
            url = new URL(req.body.url!).href;
          } catch {
            return reply.code(400).send({ error: "invalid_webhook_target" });
          }
        }
        const hash = createHash("sha256")
          .update(
            JSON.stringify({
              action,
              project: req.params.projectId,
              id: req.params.id,
              url,
            }),
          )
          .digest("hex");
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const entityId = action === "rotate" ? req.params.id! : randomUUID();
          const inserted = await client.query(
            "INSERT INTO admin_mutations(environment,cluster,object_id,request_id,request_hash,entity_id,action)VALUES($1,$2,$3,$4,$5,$6,$7)ON CONFLICT DO NOTHING RETURNING entity_id",
            [
              scope.APP_ENV,
              scope.SOLANA_CLUSTER,
              actor.object_id,
              req.headers["idempotency-key"],
              hash,
              entityId,
              `webhook.${action}`,
            ],
          );
          if (!inserted.rowCount) {
            const prior = (
              await client.query(
                "SELECT request_hash,entity_id FROM admin_mutations WHERE environment=$1 AND cluster=$2 AND object_id=$3 AND request_id=$4",
                [
                  scope.APP_ENV,
                  scope.SOLANA_CLUSTER,
                  actor.object_id,
                  req.headers["idempotency-key"],
                ],
              )
            ).rows[0];
            await client.query("COMMIT");
            if (prior.request_hash !== hash)
              return reply.code(409).send({ error: "idempotency_conflict" });
            return action === "replay"
              ? { status: "replayed", replayed: true }
              : reply.code(409).send({
                  error: "secret_already_issued",
                  endpoint_id: prior.entity_id,
                });
          }
          let secret: string | undefined;
          if (action === "replay") {
            const row = (
              await client.query(
                `SELECT d.id,h.active,(d.status='inflight' AND d.locked_until>now()) AS busy FROM webhook_deliveries d JOIN webhook_endpoints h ON h.id=d.endpoint_id JOIN webhook_events e ON e.event_id=d.event_id JOIN invoices i ON i.id=e.invoice_id WHERE d.id=$1 AND h.project_id=$2 AND i.project_id=$2 AND i.environment=$3 AND i.cluster=$4 FOR UPDATE OF d`,
                [
                  req.params.id,
                  req.params.projectId,
                  scope.APP_ENV,
                  scope.SOLANA_CLUSTER,
                ],
              )
            ).rows[0];
            if (!row || row.busy || !row.active) {
              await client.query("ROLLBACK");
              return reply.code(row ? 409 : 404).send({
                error: row
                  ? row.busy
                    ? "delivery_inflight"
                    : "endpoint_inactive"
                  : "not_found",
              });
            }
            await client.query(
              "UPDATE webhook_deliveries SET status='pending',cycle_started_at=now(),cycle_attempt_count=0,next_attempt_at=now(),lease_token=NULL,locked_until=NULL,delivered_at=NULL,replay_count=replay_count+1 WHERE id=$1",
              [req.params.id],
            );
          } else {
            secret = `whsec_${randomBytes(32).toString("hex")}`;
            if (action === "create")
              await client.query(
                "INSERT INTO webhook_endpoints(id,project_id,url,kind,secret_ciphertext)VALUES($1,$2,$3,'external',$4)",
                [
                  entityId,
                  req.params.projectId,
                  url,
                  encryptSecret(secret, scope.WEBHOOK_ENCRYPTION_KEY!),
                ],
              );
            else {
              const row = (
                await client.query(
                  "SELECT kind FROM webhook_endpoints WHERE id=$1 AND project_id=$2 FOR UPDATE",
                  [req.params.id, req.params.projectId],
                )
              ).rows[0];
              if (!row || row.kind === "local_inbox") {
                await client.query("ROLLBACK");
                return reply.code(row ? 409 : 404).send({
                  error: row ? "local_fixture_secret_fixed" : "not_found",
                });
              }
              await client.query(
                "UPDATE webhook_endpoints SET secret_ciphertext=$2 WHERE id=$1",
                [
                  entityId,
                  encryptSecret(secret, scope.WEBHOOK_ENCRYPTION_KEY!),
                ],
              );
            }
          }
          const auditAction =
            action === "create"
              ? "webhook.endpoint_created"
              : action === "rotate"
                ? "webhook.secret_rotated"
                : "webhook.replayed";
          const auditId = action === "replay" ? req.params.id! : entityId;
          await client.query(
            "INSERT INTO audit_logs(project_id,action,entity_id)VALUES($1,$2,$3)",
            [req.params.projectId, auditAction, auditId],
          );
          await client.query(
            "INSERT INTO admin_audit_logs(environment,cluster,tenant_id,object_id,action,project_id,entity_id)VALUES($1,$2,$3,$4,$5,$6,$7)",
            [
              scope.APP_ENV,
              scope.SOLANA_CLUSTER,
              actor.tenant_id,
              actor.object_id,
              auditAction,
              req.params.projectId,
              auditId,
            ],
          );
          await client.query("COMMIT");
          return action === "replay"
            ? { status: "replayed" }
            : reply
                .code(action === "create" ? 201 : 200)
                .send({ id: entityId, url, signing_secret: secret });
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
  }
}
