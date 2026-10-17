import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import Fastify from "fastify";
import { createPool } from "../packages/database/src/pool.js";
import { adminAuthRoutes } from "../packages/auth/src/routes.js";
import {
  adminPermissions,
  type AdminAuthConfig,
} from "../packages/auth/src/config.js";
import type {
  IdentityProvider,
  LoginState,
} from "../packages/auth/src/oidc.js";
const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)("admin authentication/session", () => {
  const admin = createPool(url!);
  const schema = `admin_test_${randomUUID().replaceAll("-", "")}`;
  const parsed = new URL(url ?? "postgres://unused@localhost/test");
  parsed.searchParams.set("options", `-c search_path=${schema}`);
  const pool = createPool(parsed.href);
  const config: AdminAuthConfig = {
    tenant: randomUUID(),
    clientId: randomUUID(),
    secret: "test-secret-unused-in-provider",
    origin: "http://localhost:3100",
    allowed: {},
  };
  const objectId = randomUUID();
  config.allowed[objectId] = "admin";
  let identity = { tenant: config.tenant, objectId };
  let observed: LoginState | undefined;
  const provider: IdentityProvider = {
    async begin() {
      return {
        state: "expected-state",
        nonce: "expected-nonce",
        verifier: "expected-verifier",
        url: "https://login.microsoftonline.com/authorize",
      };
    },
    async complete(url, state) {
      observed = state;
      if (url.searchParams.get("state") !== state.state)
        throw new Error("bad-state");
      return identity;
    },
  };
  const app = Fastify();
  adminAuthRoutes(
    app,
    pool,
    { APP_ENV: "test", SOLANA_CLUSTER: "localnet", WEB_ORIGIN: config.origin },
    config,
    provider,
  );
  const staging = Fastify();
  adminAuthRoutes(
    staging,
    pool,
    { APP_ENV: "staging", SOLANA_CLUSTER: "devnet", WEB_ORIGIN: config.origin },
    config,
    provider,
  );
  const disabled = Fastify();
  adminAuthRoutes(disabled, pool, {
    APP_ENV: "test",
    SOLANA_CLUSTER: "localnet",
    WEB_ORIGIN: config.origin,
  });
  beforeAll(async () => {
    await admin.query(`CREATE SCHEMA ${schema}`);
    for (const file of (await readdir("packages/database/migrations"))
      .filter((f) => f.endsWith(".sql"))
      .sort())
      await pool.query(
        await readFile(`packages/database/migrations/${file}`, "utf8"),
      );
  });
  afterAll(async () => {
    await Promise.all([app.close(), staging.close(), disabled.close()]);
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  });
  const getCookie = (headers: Record<string, unknown>, suffix: string) => {
    const set = headers["set-cookie"];
    return (Array.isArray(set) ? set : [set])
      .find((c: unknown) => typeof c === "string" && c.includes(suffix))
      ?.split(";")[0] as string;
  };
  async function login() {
    const start = await app.inject({
      method: "POST",
      url: "/admin/auth/login",
      headers: { origin: config.origin },
    });
    expect(start.statusCode).toBe(303);
    const cookie = getCookie(start.headers, "_login=");
    const finish = await app.inject({
      url: "/admin/auth/callback?code=stub&state=expected-state",
      headers: { cookie },
    });
    return { cookie, finish };
  }
  it("keeps auth disabled without configuration and rejects forged session cookies", async () => {
    expect(
      (await disabled.inject({ url: "/admin/auth/session" })).statusCode,
    ).toBe(503);
    expect(
      (
        await app.inject({
          url: "/admin/auth/session",
          headers: { cookie: `zekivo_test_localnet_session=${"a".repeat(43)}` },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/admin/auth/login",
          headers: { origin: "https://evil.example" },
        })
      ).statusCode,
    ).toBe(403);
  });
  it("creates a hashed opaque session with one-use login state and resolves permissions server-side", async () => {
    const { cookie, finish } = await login();
    expect(finish.statusCode).toBe(303);
    expect(finish.headers.location).toBe(`${config.origin}/dashboard`);
    expect(observed).toEqual({
      state: "expected-state",
      nonce: "expected-nonce",
      verifier: "expected-verifier",
    });
    const session = getCookie(finish.headers, "_session=");
    expect(finish.headers["set-cookie"]).toEqual(
      expect.arrayContaining([
        expect.stringContaining("HttpOnly; SameSite=Lax"),
      ]),
    );
    const response = await app.inject({
      url: "/admin/auth/session",
      headers: { cookie: session },
    });
    expect(response.json()).toMatchObject({
      role: "admin",
      permissions: adminPermissions("admin"),
    });
    expect(response.headers["cache-control"]).toBe("no-store");
    const stored = (await pool.query("SELECT token_hash FROM admin_sessions"))
      .rows;
    expect(stored.every((r) => !session.includes(r.token_hash))).toBe(true);
    expect(
      (
        await app.inject({
          url: "/admin/auth/callback?code=stub&state=expected-state",
          headers: { cookie },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await staging.inject({
          url: "/admin/auth/session",
          headers: { cookie: session },
        })
      ).statusCode,
    ).toBe(401);
  });
  it("checks role/allowlist on every request and rejects expired or revoked sessions", async () => {
    const { finish } = await login();
    const cookie = getCookie(finish.headers, "_session=");
    config.allowed[objectId] = "read-only";
    expect(
      (
        await app.inject({ url: "/admin/auth/session", headers: { cookie } })
      ).json().permissions,
    ).toEqual(["dashboard:read"]);
    delete config.allowed[objectId];
    expect(
      (await app.inject({ url: "/admin/auth/session", headers: { cookie } }))
        .statusCode,
    ).toBe(401);
    config.allowed[objectId] = "admin";
    await pool.query(
      "UPDATE admin_sessions SET expires_at=now()-interval '1 second'",
    );
    expect(
      (await app.inject({ url: "/admin/auth/session", headers: { cookie } }))
        .statusCode,
    ).toBe(401);
  });
  it("rejects identities outside tenant or allowlist and invalid callback state", async () => {
    identity = { tenant: randomUUID(), objectId };
    expect((await login()).finish.statusCode).toBe(403);
    identity = { tenant: config.tenant, objectId: randomUUID() };
    expect((await login()).finish.statusCode).toBe(403);
    identity = { tenant: config.tenant, objectId };
    const start = await app.inject({
      method: "POST",
      url: "/admin/auth/login",
      headers: { origin: config.origin },
    });
    const cookie = getCookie(start.headers, "_login=");
    expect(
      (
        await app.inject({
          url: "/admin/auth/callback?code=stub&state=wrong",
          headers: { cookie },
        })
      ).statusCode,
    ).toBe(401);
  });
  it("requires origin plus CSRF for logout and revokes the session with an audit record", async () => {
    const { finish } = await login();
    const cookie = getCookie(finish.headers, "_session=");
    const session = (
      await app.inject({ url: "/admin/auth/session", headers: { cookie } })
    ).json();
    for (const extra of [
      {},
      { origin: config.origin, "x-csrf-token": "invalid" },
    ])
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/admin/auth/logout",
            headers: { cookie, ...extra },
          })
        ).statusCode,
      ).toBe(403);
    const response = await app.inject({
      method: "POST",
      url: "/admin/auth/logout",
      headers: {
        cookie,
        origin: config.origin,
        "x-csrf-token": session.csrf_token,
      },
    });
    expect(response.statusCode).toBe(200);
    expect(
      (await app.inject({ url: "/admin/auth/session", headers: { cookie } }))
        .statusCode,
    ).toBe(401);
    expect(
      (
        await pool.query(
          "SELECT 1 FROM admin_audit_logs WHERE action='session.revoked'",
        )
      ).rowCount,
    ).toBe(1);
  });
  it("sets Secure cookies on staging", async () => {
    const response = await staging.inject({
      method: "POST",
      url: "/admin/auth/login",
      headers: { origin: config.origin },
    });
    expect(response.statusCode).toBe(303);
    expect(response.headers["set-cookie"]).toContain("; Secure");
  });
});
