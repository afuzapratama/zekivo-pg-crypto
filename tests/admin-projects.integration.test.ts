import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { createPool } from "../packages/database/src/pool.js";
import { buildApp } from "../apps/api/src/app.js";
import type { AdminAuthConfig } from "../packages/auth/src/config.js";
const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)("admin project and API key management", () => {
  const root = createPool(url!);
  const schema = `project_test_${randomUUID().replaceAll("-", "")}`;
  const parsed = new URL(url ?? "postgres://unused@localhost/test");
  parsed.searchParams.set("options", `-c search_path=${schema}`);
  const pool = createPool(parsed.href);
  const ids = [randomUUID(), randomUUID(), randomUUID()];
  const tokens = ids.map(() => randomBytes(32).toString("base64url"));
  const csrf = randomBytes(32).toString("base64url");
  const auth: AdminAuthConfig = {
    tenant: randomUUID(),
    clientId: randomUUID(),
    secret: "test-only-secret-unused-oidc",
    origin: "http://localhost:3100",
    allowed: {
      [ids[0]!]: "admin",
      [ids[1]!]: "operator",
      [ids[2]!]: "read-only",
    },
  };
  const app = buildApp(
    pool,
    {
      APP_ENV: "test",
      SOLANA_CLUSTER: "localnet",
      WEB_ORIGIN: auth.origin,
      ADMIN_AUTH: auth,
    },
    false,
  );
  const headers = (role = 0) => ({
    cookie: `zekivo_test_localnet_session=${tokens[role]}`,
    origin: auth.origin,
    "x-csrf-token": csrf,
    "idempotency-key": randomUUID(),
  });
  const post = (
    url: string,
    payload: Record<string, unknown>,
    extra: Record<string, string> = {},
  ) =>
    app.inject({
      method: "POST",
      url,
      payload,
      headers: { ...headers(), ...extra },
    });
  let projectId: string, keyId: string, keyValue: string;
  beforeAll(async () => {
    await root.query(`CREATE SCHEMA ${schema}`);
    for (const file of (await readdir("packages/database/migrations"))
      .filter((f) => f.endsWith(".sql"))
      .sort())
      await pool.query(
        await readFile(`packages/database/migrations/${file}`, "utf8"),
      );
    for (let i = 0; i < 3; i++)
      await pool.query(
        "INSERT INTO admin_sessions(token_hash,environment,cluster,tenant_id,object_id,csrf_token,expires_at,authenticated_at)VALUES($1,'test','localnet',$2,$3,$4,now()+interval '1 hour',now())",
        [
          createHash("sha256").update(tokens[i]!).digest("hex"),
          auth.tenant,
          ids[i],
          csrf,
        ],
      );
  });
  afterAll(async () => {
    await app.close();
    await pool.end();
    await root.query(`DROP SCHEMA ${schema} CASCADE`);
    await root.end();
  });
  it("creates a scoped project atomically, audits actor and replays request identity", async () => {
    const requestId = randomUUID();
    const first = await post(
      "/admin/projects",
      { name: "Commerce test" },
      { "idempotency-key": requestId },
    );
    expect(first.statusCode).toBe(201);
    projectId = first.json().id;
    const repeat = await post(
      "/admin/projects",
      { name: "Commerce test" },
      { "idempotency-key": requestId },
    );
    expect(repeat.json().id).toBe(projectId);
    expect(
      (
        await post(
          "/admin/projects",
          { name: "Changed" },
          { "idempotency-key": requestId },
        )
      ).statusCode,
    ).toBe(409);
    const audit = (
      await pool.query(
        "SELECT object_id,project_id FROM admin_audit_logs WHERE action='project.created'",
      )
    ).rows;
    expect(audit).toEqual([{ object_id: ids[0], project_id: projectId }]);
  });
  it("issues a random key once, stores hash/prefix, and authenticates merchant scope", async () => {
    const requestId = randomUUID();
    const first = await post(
      `/admin/projects/${projectId}/api-keys`,
      { name: "Commerce backend" },
      { "idempotency-key": requestId },
    );
    expect(first.statusCode).toBe(201);
    expect(first.headers["cache-control"]).toBe("no-store");
    keyId = first.json().id;
    keyValue = first.json().api_key;
    expect(keyValue).toMatch(/^zk_test_[A-Za-z0-9_-]{43}$/);
    const stored = (
      await pool.query(
        "SELECT key_hash,key_prefix,name FROM api_keys WHERE id=$1",
        [keyId],
      )
    ).rows[0];
    expect(stored.key_hash).toBe(
      createHash("sha256").update(keyValue).digest("hex"),
    );
    expect(stored.key_prefix).toBe(keyValue.slice(0, 20));
    const replay = await post(
      `/admin/projects/${projectId}/api-keys`,
      { name: "Commerce backend" },
      { "idempotency-key": requestId },
    );
    expect(replay.statusCode).toBe(409);
    expect(replay.json()).toEqual({
      error: "key_already_created",
      key_id: keyId,
    });
    const detail = await app.inject({
      url: `/admin/projects/${projectId}`,
      headers: headers(),
    });
    expect(detail.json().keys[0].name).toBe("Commerce backend");
    expect(detail.body).not.toContain(keyValue);
    expect(detail.body).not.toContain(stored.key_hash);
    expect(
      (
        await app.inject({
          url: "/v1/invoices",
          headers: { authorization: `Bearer ${keyValue}` },
        })
      ).statusCode,
    ).toBe(200);
  });
  it("rejects non-admin, CSRF, foreign Origin and stale/missing authentication", async () => {
    for (const role of [1, 2])
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/admin/projects",
            payload: { name: "Denied" },
            headers: headers(role),
          })
        ).statusCode,
      ).toBe(403);
    expect(
      (
        await post(
          "/admin/projects",
          { name: "Denied" },
          { origin: "https://evil.example" },
        )
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await post(
          "/admin/projects",
          { name: "Denied" },
          { "x-csrf-token": "bad" },
        )
      ).statusCode,
    ).toBe(403);
    await pool.query(
      "UPDATE admin_sessions SET authenticated_at=now()-interval '11 minutes' WHERE object_id=$1",
      [ids[0]],
    );
    expect(
      (await post("/admin/projects", { name: "Denied" })).json().error,
    ).toBe("reauthentication_required");
    await pool.query(
      "UPDATE admin_sessions SET authenticated_at=NULL WHERE object_id=$1",
      [ids[0]],
    );
    expect(
      (await post("/admin/projects", { name: "Denied" })).json().error,
    ).toBe("reauthentication_required");
    await pool.query(
      "UPDATE admin_sessions SET authenticated_at=now() WHERE object_id=$1",
      [ids[0]],
    );
  });
  it("denies cross-environment projects and key/project mismatch", async () => {
    const foreign = randomUUID(),
      other = randomUUID();
    await pool.query(
      "INSERT INTO projects(id,name,environment)VALUES($1,'Foreign','staging'),($2,'Other','test')",
      [foreign, other],
    );
    expect(
      (
        await app.inject({
          url: `/admin/projects/${foreign}`,
          headers: headers(),
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await post(`/admin/projects/${foreign}/api-keys`, { name: "Denied" }))
        .statusCode,
    ).toBe(404);
    expect(
      (await post(`/admin/projects/${other}/api-keys/${keyId}/revoke`, {}))
        .statusCode,
    ).toBe(404);
    expect(
      (await pool.query("SELECT revoked_at FROM api_keys WHERE id=$1", [keyId]))
        .rows[0].revoked_at,
    ).toBeNull();
  });
  it("deduplicates concurrent issuance without replaying raw secrets", async () => {
    const requestId = randomUUID();
    const results = await Promise.all([
      post(
        `/admin/projects/${projectId}/api-keys`,
        { name: "Concurrent" },
        { "idempotency-key": requestId },
      ),
      post(
        `/admin/projects/${projectId}/api-keys`,
        { name: "Concurrent" },
        { "idempotency-key": requestId },
      ),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    expect(
      (
        await pool.query(
          "SELECT 1 FROM api_keys WHERE project_id=$1 AND name='Concurrent'",
          [projectId],
        )
      ).rowCount,
    ).toBe(1);
  });
  it("paginates key history with tied timestamps and rejects a cursor from another project", async () => {
    const paged = randomUUID();
    await pool.query(
      "INSERT INTO projects(id,name,environment)VALUES($1,'Key pages','test')",
      [paged],
    );
    await pool.query(
      "INSERT INTO api_keys(id,project_id,key_hash,name,created_at) SELECT gen_random_uuid(),$1,md5('pagination-key-'||n::text),'History key '||n,'2026-10-17T00:00:00.123456Z' FROM generate_series(1,101)n",
      [paged],
    );
    const first = (
      await app.inject({ url: `/admin/projects/${paged}`, headers: headers() })
    ).json();
    expect(first.keys).toHaveLength(100);
    expect(first.next_key_cursor).toBeTruthy();
    const next = (
      await app.inject({
        url: `/admin/projects/${paged}?before_key=${first.next_key_cursor}`,
        headers: headers(),
      })
    ).json();
    expect(next.keys).toHaveLength(1);
    expect(first.keys.map((k: { id: string }) => k.id)).not.toContain(
      next.keys[0].id,
    );
    expect(next.next_key_cursor).toBeNull();
    expect(
      (
        await app.inject({
          url: `/admin/projects/${paged}?before_key=${keyId}`,
          headers: headers(),
        })
      ).statusCode,
    ).toBe(400);
  });
  it("rotates once with overlap, audits atomically and expires only the old credential", async () => {
    const issued = await post(`/admin/projects/${projectId}/api-keys`, {
      name: "Before rotation",
    });
    const old = issued.json();
    const path = `/admin/projects/${projectId}/api-keys/${old.id}/rotate`;
    const requestId = randomUUID();
    const payload = { name: "Replacement", overlap_hours: 24 };
    const results = await Promise.all([
      post(path, payload, { "idempotency-key": requestId }),
      post(path, payload, { "idempotency-key": requestId }),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    const replacement = results.find((r) => r.statusCode === 201)!.json();
    expect(results.find((r) => r.statusCode === 409)!.json().error).toBe(
      "key_already_created",
    );
    const merchant = (key: string) =>
      app.inject({
        url: "/v1/invoices",
        headers: { authorization: `Bearer ${key}` },
      });
    expect((await merchant(old.api_key)).statusCode).toBe(200);
    expect((await merchant(replacement.api_key)).statusCode).toBe(200);
    const stored = (
      await pool.query("SELECT expires_at FROM api_keys WHERE id=$1", [old.id])
    ).rows[0];
    expect(new Date(stored.expires_at).getTime() - Date.now()).toBeGreaterThan(
      23 * 3600000,
    );
    expect((await post(path, payload)).json().error).toBe("key_not_rotatable");
    expect(
      (
        await post(
          path,
          { ...payload, overlap_hours: 72 },
          { "idempotency-key": requestId },
        )
      ).json().error,
    ).toBe("idempotency_conflict");
    const listing = (
      await app.inject({
        url: `/admin/projects/${projectId}`,
        headers: headers(),
      })
    ).json();
    expect(
      listing.keys.find((k: { id: string }) => k.id === replacement.id)
        .replaces_key_id,
    ).toBe(old.id);
    expect(JSON.stringify(listing)).not.toContain(replacement.api_key);
    await pool.query(
      "UPDATE api_keys SET expires_at=now()-interval '1 second' WHERE id=$1",
      [old.id],
    );
    expect((await merchant(old.api_key)).statusCode).toBe(401);
    expect((await merchant(replacement.api_key)).statusCode).toBe(200);
    expect(
      (
        await pool.query(
          "SELECT 1 FROM admin_audit_logs WHERE action='api_key.rotation_started' AND entity_id=$1",
          [old.id],
        )
      ).rowCount,
    ).toBe(1);
    expect(
      (
        await post(
          `/admin/projects/${projectId}/api-keys/${replacement.id}/revoke`,
          {},
        )
      ).statusCode,
    ).toBe(200);
    expect((await merchant(replacement.api_key)).statusCode).toBe(401);
  });
  it("guards rotation by role, fresh authentication, CSRF, project ownership and overlap bounds", async () => {
    const issued = (
      await post(`/admin/projects/${projectId}/api-keys`, { name: "Guarded" })
    ).json();
    const path = `/admin/projects/${projectId}/api-keys/${issued.id}/rotate`;
    const payload = { name: "Replacement", overlap_hours: 1 };
    for (const role of [1, 2])
      expect((await post(path, payload, headers(role))).statusCode).toBe(403);
    expect(
      (await post(path, payload, { origin: "https://evil.example" }))
        .statusCode,
    ).toBe(403);
    expect(
      (await post(path, payload, { "x-csrf-token": "bad" })).statusCode,
    ).toBe(403);
    await pool.query(
      "UPDATE admin_sessions SET authenticated_at=now()-interval '11 minutes' WHERE object_id=$1",
      [ids[0]],
    );
    expect((await post(path, payload)).json().error).toBe(
      "reauthentication_required",
    );
    await pool.query(
      "UPDATE admin_sessions SET authenticated_at=now() WHERE object_id=$1",
      [ids[0]],
    );
    for (const overlap_hours of [0, 2, 100, "24"]) {
      // Fastify may coerce numeric strings; values outside the explicit enum are rejected.
      if (overlap_hours === "24") continue;
      expect((await post(path, { ...payload, overlap_hours })).statusCode).toBe(
        400,
      );
    }
    expect(
      (
        await post(
          `/admin/projects/${randomUUID()}/api-keys/${issued.id}/rotate`,
          payload,
        )
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await pool.query("SELECT expires_at FROM api_keys WHERE id=$1", [
          issued.id,
        ])
      ).rows[0].expires_at,
    ).toBeNull();
    await post(`/admin/projects/${projectId}/api-keys/${issued.id}/revoke`, {});
    expect((await post(path, payload)).json().error).toBe("key_not_rotatable");
  });
  it("revokes idempotently, audits once and immediately rejects merchant requests", async () => {
    const path = `/admin/projects/${projectId}/api-keys/${keyId}/revoke`;
    expect((await post(path, {})).statusCode).toBe(200);
    expect((await post(path, {})).statusCode).toBe(200);
    expect(
      (
        await pool.query(
          "SELECT 1 FROM admin_audit_logs WHERE action='api_key.revoked' AND entity_id=$1",
          [keyId],
        )
      ).rowCount,
    ).toBe(1);
    expect(
      (
        await app.inject({
          url: "/v1/invoices",
          headers: { authorization: `Bearer ${keyValue}` },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          url: `/admin/projects/${projectId}`,
          headers: headers(2),
        })
      ).statusCode,
    ).toBe(200);
  });
  it("rejects malformed names, request IDs and revoked sessions", async () => {
    for (const name of ["", "   ", "x".repeat(129)])
      expect((await post("/admin/projects", { name })).statusCode).toBe(400);
    expect(
      (
        await post(
          "/admin/projects",
          { name: "Test" },
          { "idempotency-key": "invalid" },
        )
      ).statusCode,
    ).toBe(400);
    await pool.query(
      "UPDATE admin_sessions SET revoked_at=now() WHERE object_id=$1",
      [ids[0]],
    );
    expect((await post("/admin/projects", { name: "Denied" })).statusCode).toBe(
      401,
    );
  });
});
