import { createHash, randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type pg from "pg";
import type { adminAuthRoutes } from "./routes.js";
import { encryptSecret, decryptSecret } from "../../webhooks/src/crypto.js";
import {
  parseChannel,
  redactChannel,
  mailpitAllowed,
} from "../../notifications/src/config.js";
import {
  recordNotification,
  type NotificationScope,
} from "../../notifications/src/queue.js";
export function adminNotificationRoutes(
  app: FastifyInstance,
  pool: pg.Pool,
  scope: NotificationScope,
  access: ReturnType<typeof adminAuthRoutes>,
) {
  const env = [scope.APP_ENV, scope.SOLANA_CLUSTER];
  const params = {
    type: "object",
    required: ["channel"],
    properties: { channel: { type: "string", enum: ["email", "telegram"] } },
  };
  const headers = {
    type: "object",
    required: ["idempotency-key"],
    properties: { "idempotency-key": { type: "string", format: "uuid" } },
  };
  app.get<{ Querystring: { before?: string } }>(
    "/notifications",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: { before: { type: "string", pattern: "^[0-9]{1,18}$" } },
        },
      },
    },
    async (req) => {
      const [channels, logs, health] = await Promise.all([
        pool.query(
          "SELECT channel,enabled,version,config_ciphertext,updated_at FROM notification_channels WHERE environment=$1 AND cluster=$2",
          env,
        ),
        pool.query(
          `SELECT d.id::text,d.channel,d.status,d.attempt_count,d.last_error,d.sent_at,d.expires_at,e.event_type,e.title,e.created_at FROM notification_deliveries d JOIN notification_events e ON e.id=d.event_id WHERE e.environment=$1 AND e.cluster=$2 AND ($3::bigint IS NULL OR d.id<$3) ORDER BY d.id DESC LIMIT 26`,
          [...env, req.query.before ?? null],
        ),
        pool.query(
          "SELECT scanner_status,last_success_at,last_error_at,updated_at FROM worker_health WHERE environment=$1 AND cluster=$2",
          env,
        ),
      ]);
      return {
        key_configured: Boolean(scope.NOTIFICATION_ENCRYPTION_KEY),
        mailpit_allowed: mailpitAllowed(scope),
        channels: channels.rows.map((c) => ({
          channel: c.channel,
          enabled: c.enabled,
          version: c.version,
          updated_at: c.updated_at,
          ...(scope.NOTIFICATION_ENCRYPTION_KEY
            ? {
                config: redactChannel(
                  c.channel,
                  parseChannel(
                    c.channel,
                    JSON.parse(
                      decryptSecret(
                        c.config_ciphertext,
                        scope.NOTIFICATION_ENCRYPTION_KEY,
                      ),
                    ),
                  ),
                ),
              }
            : {}),
        })),
        items: logs.rows.slice(0, 25),
        next_cursor: logs.rows.length > 25 ? logs.rows[24]!.id : null,
        worker: health.rows[0] ?? null,
      };
    },
  );
  for (const action of ["save", "test"] as const)
    app.post<{
      Params: { channel: string };
      Body: {
        enabled?: boolean;
        expected_version?: number;
        config?: Record<string, unknown>;
      };
    }>(
      action === "save"
        ? "/notifications/:channel"
        : "/notifications/:channel/test",
      {
        schema: {
          params,
          headers,
          body:
            action === "save"
              ? {
                  type: "object",
                  additionalProperties: false,
                  required: ["enabled", "expected_version", "config"],
                  properties: {
                    enabled: { type: "boolean" },
                    expected_version: {
                      type: "integer",
                      minimum: 0,
                      maximum: 2147483646,
                    },
                    config: { type: "object" },
                  },
                }
              : { type: "object", additionalProperties: false, properties: {} },
        },
      },
      async (req, reply) => {
        const actor = await access.authorizeWrite(
          req,
          reply,
          "notification:manage",
        );
        if (!actor) return reply;
        if (action === "save" && !scope.NOTIFICATION_ENCRYPTION_KEY)
          return reply
            .code(503)
            .send({ error: "notifications_not_configured" });
        const requestId = req.headers["idempotency-key"] as string,
          hash = createHash("sha256")
            .update(
              JSON.stringify({
                channel: req.params.channel,
                action,
                body: req.body,
              }),
            )
            .digest("hex");
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const inserted = await client.query(
            "INSERT INTO admin_mutations(environment,cluster,object_id,request_id,request_hash,entity_id,action)VALUES($1,$2,$3,$4,$5,$6,$7)ON CONFLICT DO NOTHING RETURNING entity_id",
            [
              ...env,
              actor.object_id,
              requestId,
              hash,
              randomUUID(),
              `notification.${action}`,
            ],
          );
          if (!inserted.rowCount) {
            const old = (
              await client.query(
                "SELECT request_hash FROM admin_mutations WHERE environment=$1 AND cluster=$2 AND object_id=$3 AND request_id=$4",
                [...env, actor.object_id, requestId],
              )
            ).rows[0];
            await client.query("COMMIT");
            return old.request_hash === hash
              ? {
                  status: action === "save" ? "saved" : "queued",
                  replayed: true,
                }
              : reply.code(409).send({ error: "idempotency_conflict" });
          }
          if (action === "save") {
            await client.query(
              "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
              [
                `${scope.APP_ENV}:${scope.SOLANA_CLUSTER}:notification:${req.params.channel}`,
              ],
            );
            const old = (
              await client.query(
                "SELECT version,config_ciphertext FROM notification_channels WHERE environment=$1 AND cluster=$2 AND channel=$3 FOR UPDATE",
                [...env, req.params.channel],
              )
            ).rows[0];
            if ((old?.version ?? 0) !== req.body.expected_version) {
              await client.query("ROLLBACK");
              return reply.code(409).send({ error: "settings_changed" });
            }
            const config = { ...req.body.config },
              secretField =
                req.params.channel === "email" ? "password" : "bot_token";
            if (!config[secretField] && old && config.mode !== "mailpit") {
              const previous = JSON.parse(
                decryptSecret(
                  old.config_ciphertext,
                  scope.NOTIFICATION_ENCRYPTION_KEY!,
                ),
              );
              if (
                req.params.channel === "email" &&
                (previous.host !== config.host ||
                  previous.username !== config.username)
              ) {
                await client.query("ROLLBACK");
                return reply
                  .code(400)
                  .send({ error: "invalid_channel_config" });
              }
              config[secretField] = previous[secretField];
            }
            let parsed;
            try {
              parsed = parseChannel(req.params.channel, config);
              if (
                req.params.channel === "email" &&
                "mode" in parsed &&
                parsed.mode === "mailpit" &&
                !mailpitAllowed(scope)
              )
                throw new Error("mailpit_not_allowed");
            } catch {
              await client.query("ROLLBACK");
              return reply.code(400).send({ error: "invalid_channel_config" });
            }
            await client.query(
              "INSERT INTO notification_channels(environment,cluster,channel,enabled,config_ciphertext)VALUES($1,$2,$3,$4,$5)ON CONFLICT(environment,cluster,channel)DO UPDATE SET enabled=excluded.enabled,config_ciphertext=excluded.config_ciphertext,version=notification_channels.version+1,updated_at=now()",
              [
                ...env,
                req.params.channel,
                req.body.enabled,
                encryptSecret(
                  JSON.stringify(parsed),
                  scope.NOTIFICATION_ENCRYPTION_KEY!,
                ),
              ],
            );
          } else {
            // A test creates only the explicitly selected channel delivery.
            const rows = await recordNotification(
              client,
              scope,
              `test:${actor.object_id}:${requestId}`,
              "notification.test",
              "Uji notifikasi admin",
              "Pesan uji dari dashboard Zekivo PG. Tidak ada perubahan pada transaksi pembayaran.",
            );
            if (rows.length)
              await client.query(
                "DELETE FROM notification_deliveries WHERE id=ANY($1::bigint[]) AND channel<>$2",
                [rows.map((r) => r.id), req.params.channel],
              );
          }
          await client.query(
            "INSERT INTO admin_audit_logs(environment,cluster,tenant_id,object_id,action,entity_id)VALUES($1,$2,$3,$4,$5,$6)",
            [
              ...env,
              actor.tenant_id,
              actor.object_id,
              `notification.${action}`,
              req.params.channel,
            ],
          );
          await client.query("COMMIT");
          return { status: action === "save" ? "saved" : "queued" };
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally {
          client.release();
        }
      },
    );
}
