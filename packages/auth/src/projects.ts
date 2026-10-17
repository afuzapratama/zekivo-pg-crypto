import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { adminAuthRoutes } from "./routes.js";
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export function adminProjectRoutes(
  app: FastifyInstance,
  pool: pg.Pool,
  scope: { APP_ENV: string; SOLANA_CLUSTER: string },
  access: ReturnType<typeof adminAuthRoutes>,
) {
  const projectParams = {
    type: "object",
    required: ["projectId"],
    properties: { projectId: { type: "string", format: "uuid" } },
  } as const;
  const nameBody = {
    type: "object",
    additionalProperties: false,
    required: ["name"],
    properties: {
      name: { type: "string", minLength: 1, maxLength: 128, pattern: "\\S" },
    },
  } as const;
  const metadata =
    "id,name,key_prefix,created_at,revoked_at,expires_at,replaces_key_id";
  app.get<{
    Params: { projectId: string };
    Querystring: { before_key?: string };
  }>(
    "/projects/:projectId",
    {
      schema: {
        params: projectParams,
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: { before_key: { type: "string", format: "uuid" } },
        },
      },
    },
    async (req, reply) => {
      const project = (
        await pool.query(
          "SELECT id,name,environment,created_at FROM projects WHERE id=$1 AND environment=$2",
          [req.params.projectId, scope.APP_ENV],
        )
      ).rows[0];
      if (!project) return reply.code(404).send({ error: "not_found" });
      if (
        req.query.before_key &&
        !(
          await pool.query(
            "SELECT 1 FROM api_keys WHERE id=$1 AND project_id=$2",
            [req.query.before_key, project.id],
          )
        ).rowCount
      )
        return reply.code(400).send({ error: "invalid_cursor" });
      const [keys, stats] = await Promise.all([
        pool.query(
          `SELECT ${metadata} FROM api_keys WHERE project_id=$1 AND ($2::uuid IS NULL OR (created_at,id)<(SELECT created_at,id FROM api_keys WHERE id=$2 AND project_id=$1)) ORDER BY created_at DESC,id DESC LIMIT 101`,
          [project.id, req.query.before_key ?? null],
        ),
        pool.query(
          "SELECT count(*)::text AS total,count(*) FILTER(WHERE status='paid')::text AS paid FROM invoices WHERE project_id=$1 AND environment=$2 AND cluster=$3",
          [project.id, scope.APP_ENV, scope.SOLANA_CLUSTER],
        ),
      ]);
      return {
        project,
        keys: keys.rows.slice(0, 100),
        has_more_keys: keys.rows.length > 100,
        next_key_cursor: keys.rows.length > 100 ? keys.rows[99]!.id : null,
        invoice_counts: stats.rows[0],
      };
    },
  );
  async function audit(
    client: pg.PoolClient,
    actor: { tenant_id: string; object_id: string },
    action: string,
    projectId: string,
    entityId: string,
  ) {
    await client.query(
      "INSERT INTO admin_audit_logs(environment,cluster,tenant_id,object_id,action,project_id,entity_id)VALUES($1,$2,$3,$4,$5,$6,$7)",
      [
        scope.APP_ENV,
        scope.SOLANA_CLUSTER,
        actor.tenant_id,
        actor.object_id,
        action,
        projectId,
        entityId,
      ],
    );
  }
  for (const kind of ["project", "key", "rotation"] as const) {
    app.post<{
      Params: { projectId?: string; keyId?: string };
      Body: { name: string; overlap_hours?: number };
    }>(
      kind === "project"
        ? "/projects"
        : kind === "key"
          ? "/projects/:projectId/api-keys"
          : "/projects/:projectId/api-keys/:keyId/rotate",
      {
        schema: {
          body:
            kind === "rotation"
              ? {
                  ...nameBody,
                  required: ["name", "overlap_hours"],
                  properties: {
                    ...nameBody.properties,
                    overlap_hours: { type: "integer", enum: [1, 24, 72] },
                  },
                }
              : nameBody,
          ...(kind === "project"
            ? {}
            : {
                params:
                  kind === "rotation"
                    ? {
                        ...projectParams,
                        required: ["projectId", "keyId"],
                        properties: {
                          ...projectParams.properties,
                          keyId: { type: "string", format: "uuid" },
                        },
                      }
                    : projectParams,
              }),
          headers: {
            type: "object",
            required: ["idempotency-key"],
            properties: {
              "idempotency-key": { type: "string", format: "uuid" },
            },
          },
        },
      },
      async (req, reply) => {
        const actor = await access.authorizeWrite(req, reply, "project:manage");
        if (!actor) return reply;
        const name = req.body.name.trim(),
          projectId = kind === "project" ? null : req.params.projectId!;
        const requestId = req.headers["idempotency-key"] as string;
        const requestHash = hash(
          JSON.stringify({
            kind,
            name,
            projectId,
            ...(kind === "rotation"
              ? { keyId: req.params.keyId, overlap: req.body.overlap_hours }
              : {}),
          }),
        );
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          if (
            projectId &&
            !(
              await client.query(
                "SELECT 1 FROM projects WHERE id=$1 AND environment=$2 FOR SHARE",
                [projectId, scope.APP_ENV],
              )
            ).rowCount
          ) {
            await client.query("ROLLBACK");
            return reply.code(404).send({ error: "not_found" });
          }
          const entityId = randomUUID();
          const inserted = await client.query(
            "INSERT INTO admin_mutations(environment,cluster,object_id,request_id,request_hash,entity_id,action)VALUES($1,$2,$3,$4,$5,$6,$7)ON CONFLICT DO NOTHING RETURNING entity_id",
            [
              scope.APP_ENV,
              scope.SOLANA_CLUSTER,
              actor.object_id,
              requestId,
              requestHash,
              entityId,
              kind,
            ],
          );
          if (!inserted.rowCount) {
            const previous = (
              await client.query(
                "SELECT request_hash,entity_id FROM admin_mutations WHERE environment=$1 AND cluster=$2 AND object_id=$3 AND request_id=$4",
                [
                  scope.APP_ENV,
                  scope.SOLANA_CLUSTER,
                  actor.object_id,
                  requestId,
                ],
              )
            ).rows[0];
            await client.query("COMMIT");
            if (previous.request_hash !== requestHash)
              return reply.code(409).send({ error: "idempotency_conflict" });
            if (kind !== "project")
              return reply.code(409).send({
                error: "key_already_created",
                key_id: previous.entity_id,
              });
            return { id: previous.entity_id, replayed: true };
          }
          if (kind === "project") {
            await client.query(
              "INSERT INTO projects(id,name,environment)VALUES($1,$2,$3)",
              [entityId, name, scope.APP_ENV],
            );
            await audit(client, actor, "project.created", entityId, entityId);
            await client.query("COMMIT");
            return reply.code(201).send({ id: entityId, name });
          }
          if (kind === "rotation") {
            const old = (
              await client.query(
                "SELECT k.id,k.revoked_at,k.expires_at FROM api_keys k WHERE k.id=$1 AND k.project_id=$2 FOR UPDATE",
                [req.params.keyId, projectId],
              )
            ).rows[0];
            if (!old) {
              await client.query("ROLLBACK");
              return reply.code(404).send({ error: "not_found" });
            }
            if (
              old.revoked_at ||
              old.expires_at ||
              (
                await client.query(
                  "SELECT 1 FROM api_keys WHERE replaces_key_id=$1",
                  [old.id],
                )
              ).rowCount
            ) {
              await client.query("ROLLBACK");
              return reply.code(409).send({ error: "key_not_rotatable" });
            }
            await client.query(
              "UPDATE api_keys SET expires_at=now()+($2::int * interval '1 hour') WHERE id=$1",
              [old.id, req.body.overlap_hours],
            );
            await audit(
              client,
              actor,
              "api_key.rotation_started",
              projectId!,
              old.id,
            );
          }
          const key = `zk_${scope.APP_ENV}_${randomBytes(32).toString("base64url")}`;
          const prefix = key.slice(0, Math.min(key.length, 20));
          await client.query(
            "INSERT INTO api_keys(id,project_id,key_hash,name,key_prefix,replaces_key_id)VALUES($1,$2,$3,$4,$5,$6)",
            [
              entityId,
              projectId,
              hash(key),
              name,
              prefix,
              kind === "rotation" ? req.params.keyId : null,
            ],
          );
          await audit(client, actor, "api_key.created", projectId!, entityId);
          await client.query("COMMIT");
          return reply
            .code(201)
            .send({ id: entityId, name, key_prefix: prefix, api_key: key });
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally {
          client.release();
        }
      },
    );
  }
  app.post<{ Params: { projectId: string; keyId: string } }>(
    "/projects/:projectId/api-keys/:keyId/revoke",
    {
      schema: {
        params: {
          type: "object",
          required: ["projectId", "keyId"],
          properties: {
            ...projectParams.properties,
            keyId: { type: "string", format: "uuid" },
          },
        },
      },
    },
    async (req, reply) => {
      const actor = await access.authorizeWrite(req, reply, "project:manage");
      if (!actor) return reply;
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const row = (
          await client.query(
            "SELECT k.id,k.revoked_at FROM api_keys k JOIN projects p ON p.id=k.project_id WHERE k.id=$1 AND k.project_id=$2 AND p.environment=$3 FOR UPDATE OF k",
            [req.params.keyId, req.params.projectId, scope.APP_ENV],
          )
        ).rows[0];
        if (!row) {
          await client.query("ROLLBACK");
          return reply.code(404).send({ error: "not_found" });
        }
        if (!row.revoked_at) {
          await client.query(
            "UPDATE api_keys SET revoked_at=now() WHERE id=$1",
            [row.id],
          );
          await audit(
            client,
            actor,
            "api_key.revoked",
            req.params.projectId,
            row.id,
          );
        }
        await client.query("COMMIT");
        return { id: row.id, revoked: true };
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
  );
}
