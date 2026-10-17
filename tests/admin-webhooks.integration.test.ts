import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { createPool } from "../packages/database/src/pool.js";
import { buildApp } from "../apps/api/src/app.js";
import type { AdminAuthConfig } from "../packages/auth/src/config.js";
vi.mock("../packages/webhooks/src/transport.js", async (original) => ({
  ...(await original<typeof import("../packages/webhooks/src/transport.js")>()),
  resolveTarget: vi.fn(async (target: { url: string }) => {
    if (!target.url.startsWith("https://merchant.example/"))
      throw new Error("unsafe_target");
    return target;
  }),
}));
const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)("admin webhook settings", () => {
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
      WEBHOOK_ENCRYPTION_KEY: "ab".repeat(32),
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
  const projectId = randomUUID();
  let endpointId: string, deliveryId: string;
  beforeAll(async () => {
    await root.query(`CREATE SCHEMA ${schema}`);
    for (const file of (await readdir("packages/database/migrations"))
      .filter((f) => f.endsWith(".sql"))
      .sort())
      await pool.query(
        await readFile(`packages/database/migrations/${file}`, "utf8"),
      );
    await pool.query(
      "INSERT INTO projects(id,name,environment)VALUES($1,'Test merchant','test')",
      [projectId],
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
  const base = () => `/admin/projects/${projectId}`;
  it("creates an encrypted secret once and atomically audits the admin", async () => {
    const request = { "idempotency-key": randomUUID() };
    const response = await post(
      `${base()}/webhook-endpoints`,
      { url: "https://merchant.example/webhook" },
      request,
    );
    expect(response.statusCode).toBe(201);
    endpointId = response.json().id;
    expect(response.headers["cache-control"]).toBe("no-store");
    const secret = response.json().signing_secret;
    expect(secret).toMatch(/^whsec_[a-f0-9]{64}$/);
    const stored = (
      await pool.query(
        "SELECT secret_ciphertext FROM webhook_endpoints WHERE id=$1",
        [endpointId],
      )
    ).rows[0];
    expect(stored.secret_ciphertext).not.toContain(secret);
    const repeated = await post(
      `${base()}/webhook-endpoints`,
      { url: "https://merchant.example/webhook" },
      request,
    );
    expect(repeated.statusCode).toBe(409);
    expect(repeated.json().error).toBe("secret_already_issued");
    expect(
      (
        await pool.query(
          "SELECT object_id FROM admin_audit_logs WHERE action='webhook.endpoint_created'",
        )
      ).rows,
    ).toEqual([{ object_id: ids[0] }]);
  });
  it("blocks unsafe targets, cross environment projects, CSRF and insufficient roles", async () => {
    expect(
      (await post(`${base()}/webhook-endpoints`, { url: "http://localhost/" }))
        .statusCode,
    ).toBe(400);
    expect(
      (
        await post(
          `${base()}/webhook-endpoints`,
          { url: "https://merchant.example/other" },
          headers(1),
        )
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await post(
          `${base()}/webhook-endpoints`,
          { url: "https://merchant.example/other" },
          { "x-csrf-token": "bad" },
        )
      ).statusCode,
    ).toBe(403);
    const foreign = randomUUID();
    await pool.query(
      "INSERT INTO projects(id,name,environment)VALUES($1,'Foreign','staging')",
      [foreign],
    );
    expect(
      (
        await app.inject({
          url: `/admin/projects/${foreign}/webhooks`,
          headers: headers(),
        })
      ).statusCode,
    ).toBe(404);
    await pool.query(
      "UPDATE admin_sessions SET authenticated_at=now()-interval '11 minutes' WHERE object_id=$1",
      [ids[0]],
    );
    expect(
      (
        await post(
          `${base()}/webhook-endpoints/${endpointId}/rotate-secret`,
          {},
        )
      ).json().error,
    ).toBe("reauthentication_required");
    await pool.query(
      "UPDATE admin_sessions SET authenticated_at=now() WHERE object_id=$1",
      [ids[0]],
    );
  });
  it("rotates once under concurrent retries, keeps plaintext out of reads", async () => {
    const request = { "idempotency-key": randomUUID() };
    const responses = await Promise.all([
      post(
        `${base()}/webhook-endpoints/${endpointId}/rotate-secret`,
        {},
        request,
      ),
      post(
        `${base()}/webhook-endpoints/${endpointId}/rotate-secret`,
        {},
        request,
      ),
    ]);
    expect(responses.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    const read = await app.inject({
      url: `${base()}/webhooks`,
      headers: headers(2),
    });
    expect(read.statusCode).toBe(200);
    expect(read.json().endpoints[0].secret_ciphertext).toBeUndefined();
    expect(read.json().endpoints[0].signing_secret).toBeUndefined();
    expect(read.json().delivery_enabled).toBe(false);
    expect(
      (
        await pool.query(
          "SELECT 1 FROM admin_audit_logs WHERE action='webhook.secret_rotated'",
        )
      ).rowCount,
    ).toBe(1);
  });
  it("lists only the current cluster and replays exactly once with operator audit", async () => {
    for (const cluster of ["localnet", "devnet"]) {
      const invoice = randomUUID(),
        event = randomUUID();
      await pool.query(
        "INSERT INTO invoices(id,project_id,environment,cluster,asset,recipient,mint,order_id,base_units,payable_units,checkout_token,expires_at)VALUES($1::uuid,$2,'test',$3,'USDC','recipient','mint',$1::text,1,1,$1::text,now())",
        [invoice, projectId, cluster],
      );
      await pool.query(
        "INSERT INTO webhook_events(event_id,invoice_id,event_type,payload)VALUES($1,$2,'payment.confirmed','{}')",
        [event, invoice],
      );
      const d = (
        await pool.query(
          "INSERT INTO webhook_deliveries(event_id,endpoint_id,status)VALUES($1,$2,'dead')RETURNING id::text",
          [event, endpointId],
        )
      ).rows[0].id;
      if (cluster === "localnet") deliveryId = d;
      else
        expect(
          (await post(`${base()}/webhook-deliveries/${d}/replay`, {}))
            .statusCode,
        ).toBe(404);
    }
    const read = await app.inject({
      url: `${base()}/webhooks`,
      headers: headers(),
    });
    expect(read.json().deliveries).toHaveLength(1);
    const request = { ...headers(1), "idempotency-key": randomUUID() };
    expect(
      (
        await post(
          `${base()}/webhook-deliveries/${deliveryId}/replay`,
          {},
          request,
        )
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await post(
          `${base()}/webhook-deliveries/${deliveryId}/replay`,
          {},
          request,
        )
      ).json().replayed,
    ).toBe(true);
    expect(
      (
        await pool.query(
          "SELECT replay_count,status FROM webhook_deliveries WHERE id=$1",
          [deliveryId],
        )
      ).rows[0],
    ).toMatchObject({ replay_count: 1, status: "pending" });
    expect(
      (
        await pool.query(
          "SELECT object_id FROM admin_audit_logs WHERE action='webhook.replayed'",
        )
      ).rows,
    ).toEqual([{ object_id: ids[1] }]);
    await pool.query(
      "UPDATE webhook_deliveries SET status='inflight',locked_until=now()+interval '1 minute' WHERE id=$1",
      [deliveryId],
    );
    expect(
      (
        await post(`${base()}/webhook-deliveries/${deliveryId}/replay`, {})
      ).json().error,
    ).toBe("delivery_inflight");
    expect(
      (
        await app.inject({
          url: `${base()}/webhook-deliveries/${deliveryId}/attempts`,
          headers: headers(2),
        })
      ).json().items,
    ).toEqual([]);
  });
});
