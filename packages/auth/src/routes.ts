import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type pg from "pg";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { adminPermissions, type AdminAuthConfig } from "./config.js";
import {
  entraProvider,
  type IdentityProvider,
  type LoginState,
} from "./oidc.js";
const hash = (v: string) => createHash("sha256").update(v).digest("hex");
const random = () => randomBytes(32).toString("base64url");
export function adminAuthRoutes(
  app: FastifyInstance,
  pool: pg.Pool,
  scope: { APP_ENV: string; SOLANA_CLUSTER: string; WEB_ORIGIN: string },
  config?: AdminAuthConfig,
  injectedProvider?: IdentityProvider,
) {
  const enabled = config && config.origin === scope.WEB_ORIGIN;
  const provider = enabled
    ? (injectedProvider ?? entraProvider(config))
    : undefined;
  const prefix = `zekivo_${scope.APP_ENV}_${scope.SOLANA_CLUSTER}`;
  const sessionCookie = `${prefix}_session`,
    loginCookie = `${prefix}_login`;
  const cookie = (name: string, value: string, age: number) =>
    `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${(scope.APP_ENV !== "local" && scope.APP_ENV !== "test") || scope.WEB_ORIGIN.startsWith("https://") ? "; Secure" : ""}`;
  function readCookie(req: FastifyRequest, name: string) {
    const values = (req.headers.cookie ?? "")
      .split(";")
      .map((p) => p.trim())
      .filter((p) => p.startsWith(`${name}=`));
    if (values.length !== 1) return undefined;
    const value = values[0]!.slice(name.length + 1);
    return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : undefined;
  }
  const params = [scope.APP_ENV, scope.SOLANA_CLUSTER];
  async function session(req: FastifyRequest) {
    if (!enabled) return undefined;
    const token = readCookie(req, sessionCookie);
    if (!token) return undefined;
    const row = (
      await pool.query(
        "SELECT token_hash,object_id,tenant_id,csrf_token,expires_at,authenticated_at FROM admin_sessions WHERE token_hash=$1 AND environment=$2 AND cluster=$3 AND revoked_at IS NULL AND expires_at>now()",
        [hash(token), ...params],
      )
    ).rows[0];
    if (!row || row.tenant_id !== config.tenant) return undefined;
    const role = config.allowed[row.object_id];
    if (!role) return undefined;
    return { ...row, role, permissions: adminPermissions(role) };
  }
  app.get("/admin/auth/session", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    if (!enabled)
      return reply.code(503).send({ error: "admin_auth_not_configured" });
    const current = await session(req);
    if (!current) return reply.code(401).send({ error: "unauthorized" });
    return {
      object_id: current.object_id,
      role: current.role,
      permissions: current.permissions,
      csrf_token: current.csrf_token,
      expires_at: current.expires_at,
      reauthentication_required:
        !current.authenticated_at ||
        Date.now() - new Date(current.authenticated_at).getTime() > 600000,
    };
  });
  app.post(
    "/admin/auth/login",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (req, reply) => {
      reply.header("Cache-Control", "no-store");
      if (!enabled || !provider)
        return reply.code(503).send({ error: "admin_auth_not_configured" });
      if (req.headers.origin !== config.origin)
        return reply.code(403).send({ error: "forbidden" });
      try {
        const state = await provider.begin(),
          token = random();
        await pool.query(
          "DELETE FROM admin_login_requests WHERE expires_at<=now()",
        );
        await pool.query(
          "INSERT INTO admin_login_requests(token_hash,environment,cluster,state,nonce,verifier,expires_at) VALUES($1,$2,$3,$4,$5,$6,now()+interval '10 minutes')",
          [hash(token), ...params, state.state, state.nonce, state.verifier],
        );
        return reply
          .header("Set-Cookie", cookie(loginCookie, token, 600))
          .redirect(state.url, 303);
      } catch {
        return reply.code(503).send({ error: "identity_provider_unavailable" });
      }
    },
  );
  app.get("/admin/auth/callback", async (req, reply) => {
    reply
      .header("Cache-Control", "no-store")
      .header("Referrer-Policy", "no-referrer");
    if (!enabled || !provider)
      return reply.code(503).send({ error: "admin_auth_not_configured" });
    reply.header("Set-Cookie", cookie(loginCookie, "", 0));
    const token = readCookie(req, loginCookie);
    if (!token) return reply.code(401).send({ error: "login_failed" });
    const pending = (
      await pool.query<LoginState>(
        "DELETE FROM admin_login_requests WHERE token_hash=$1 AND environment=$2 AND cluster=$3 AND expires_at>now() RETURNING state,nonce,verifier",
        [hash(token), ...params],
      )
    ).rows[0];
    if (!pending) return reply.code(401).send({ error: "login_failed" });
    try {
      const callback = new URL(`${config.origin}/api/admin/auth/callback`);
      callback.search = new URL(req.url, "http://internal").search;
      const identity = await provider.complete(callback, pending);
      if (
        identity.tenant !== config.tenant ||
        !config.allowed[identity.objectId]
      )
        return reply.code(403).send({ error: "identity_not_allowed" });
      const client = await pool.connect();
      const sessionToken = random();
      try {
        await client.query("BEGIN");
        // Rotate/revoke the existing browser session when logging in again.
        const old = readCookie(req, sessionCookie);
        if (old)
          await client.query(
            "UPDATE admin_sessions SET revoked_at=now() WHERE token_hash=$1 AND environment=$2 AND cluster=$3",
            [hash(old), ...params],
          );
        await client.query(
          "INSERT INTO admin_sessions(token_hash,environment,cluster,tenant_id,object_id,csrf_token,expires_at,authenticated_at) VALUES($1,$2,$3,$4,$5,$6,now()+interval '1 hour',to_timestamp($7))",
          [
            hash(sessionToken),
            ...params,
            identity.tenant,
            identity.objectId,
            random(),
            identity.authenticatedAt ?? null,
          ],
        );
        await client.query(
          "INSERT INTO admin_audit_logs(environment,cluster,tenant_id,object_id,action) VALUES($1,$2,$3,$4,'session.created')",
          [...params, identity.tenant, identity.objectId],
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
      return reply
        .header("Set-Cookie", [
          cookie(loginCookie, "", 0),
          cookie(sessionCookie, sessionToken, 3600),
        ])
        .redirect(`${config.origin}/dashboard`, 303);
    } catch {
      return reply.code(401).send({ error: "login_failed" });
    }
  });
  app.post("/admin/auth/logout", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    if (!enabled)
      return reply.code(503).send({ error: "admin_auth_not_configured" });
    if (req.headers.origin !== config.origin)
      return reply.code(403).send({ error: "forbidden" });
    const current = await session(req);
    if (!current) return reply.code(401).send({ error: "unauthorized" });
    const csrf = req.headers["x-csrf-token"];
    if (
      typeof csrf !== "string" ||
      Buffer.byteLength(csrf) !== Buffer.byteLength(current.csrf_token) ||
      !timingSafeEqual(Buffer.from(csrf), Buffer.from(current.csrf_token))
    )
      return reply.code(403).send({ error: "invalid_csrf" });
    await pool.query(
      "WITH revoked AS (UPDATE admin_sessions SET revoked_at=now() WHERE token_hash=$1 AND revoked_at IS NULL RETURNING tenant_id,object_id) INSERT INTO admin_audit_logs(environment,cluster,tenant_id,object_id,action) SELECT $2,$3,tenant_id,object_id,'session.revoked' FROM revoked",
      [current.token_hash, ...params],
    );
    return reply
      .header("Set-Cookie", cookie(sessionCookie, "", 0))
      .send({ logged_out: true });
  });
  return {
    async authorizeWrite(
      req: FastifyRequest,
      reply: FastifyReply,
      permission: string,
    ) {
      reply.header("Cache-Control", "no-store");
      const deny = (status: number, error: string) => {
        reply.code(status).send({ error });
        return undefined;
      };
      if (!enabled) return deny(503, "admin_auth_not_configured");
      const current = await session(req);
      if (!current) return deny(401, "unauthorized");
      if (!current.permissions.includes(permission))
        return deny(403, "forbidden");
      if (req.headers.origin !== config.origin) return deny(403, "forbidden");
      const csrf = req.headers["x-csrf-token"];
      if (
        typeof csrf !== "string" ||
        Buffer.byteLength(csrf) !== Buffer.byteLength(current.csrf_token) ||
        !timingSafeEqual(Buffer.from(csrf), Buffer.from(current.csrf_token))
      )
        return deny(403, "invalid_csrf");
      const age = current.authenticated_at
        ? Date.now() - new Date(current.authenticated_at).getTime()
        : Infinity;
      if (!Number.isFinite(age) || age > 600000 || age < -60000)
        return deny(403, "reauthentication_required");
      return current;
    },
    async requirePermission(
      req: FastifyRequest,
      reply: FastifyReply,
      permission: string,
    ) {
      reply.header("Cache-Control", "no-store");
      if (!enabled)
        return reply.code(503).send({ error: "admin_auth_not_configured" });
      const current = await session(req);
      if (!current) return reply.code(401).send({ error: "unauthorized" });
      if (!current.permissions.includes(permission))
        return reply.code(403).send({ error: "forbidden" });
    },
  };
}
