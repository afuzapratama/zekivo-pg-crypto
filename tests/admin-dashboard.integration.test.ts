import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import Fastify from "fastify";
import { createPool } from "../packages/database/src/pool.js";
import { createInvoice } from "../packages/database/src/invoices.js";
import { adminAuthRoutes } from "../packages/auth/src/routes.js";
import { adminDashboardRoutes } from "../packages/auth/src/dashboard.js";
import type { AdminAuthConfig } from "../packages/auth/src/config.js";
const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)("admin dashboard data", () => {
  const admin = createPool(url!);
  const schema = `dashboard_test_${randomUUID().replaceAll("-", "")}`;
  const parsed = new URL(url ?? "postgres://unused@localhost/test");
  parsed.searchParams.set("options", `-c search_path=${schema}`);
  const pool = createPool(parsed.href);
  const scope = {
    APP_ENV: "test",
    SOLANA_CLUSTER: "localnet",
    WEB_ORIGIN: "http://localhost:3100",
  };
  const object = randomUUID();
  const config: AdminAuthConfig = {
    tenant: randomUUID(),
    clientId: randomUUID(),
    secret: "test-only-not-a-real-secret",
    origin: scope.WEB_ORIGIN,
    allowed: { [object]: "read-only" },
  };
  const app = Fastify({ ajv: { customOptions: { removeAdditional: false } } });
  const access = adminAuthRoutes(app, pool, scope, config);
  adminDashboardRoutes(app, pool, scope, access);
  const token = randomBytes(32).toString("base64url");
  const headers = { cookie: `zekivo_test_localnet_session=${token}` };
  const projects = [randomUUID(), randomUUID(), randomUUID()];
  let invoiceA: string, invoiceB: string, foreign: string;
  beforeAll(async () => {
    await admin.query(`CREATE SCHEMA ${schema}`);
    for (const name of (await readdir("packages/database/migrations"))
      .filter((n) => n.endsWith(".sql"))
      .sort())
      await pool.query(
        await readFile(`packages/database/migrations/${name}`, "utf8"),
      );
    for (let n = 0; n < 3; n++)
      await pool.query(
        "INSERT INTO projects(id,name,environment)VALUES($1,$2,$3)",
        [projects[n], `Project ${n}`, n === 2 ? "staging" : "test"],
      );
    const create = async (
      project: string,
      env: string,
      cluster: string,
      asset: "USDC" | "USDT",
      amount: string,
    ) =>
      (
        await createInvoice(pool, project, env, cluster, randomUUID(), {
          order_id: randomUUID(),
          asset,
          amount,
        })
      ).row;
    const a = await create(projects[0]!, "test", "localnet", "USDC", "3");
    invoiceA = String(a.id);
    const b = await create(projects[1]!, "test", "localnet", "USDT", "5");
    invoiceB = String(b.id);
    foreign = String(
      (await create(projects[2]!, "staging", "devnet", "USDC", "9")).id,
    );
    await create(projects[0]!, "test", "devnet", "USDC", "8");
    const transfer = (
      await pool.query(
        "INSERT INTO chain_transfers(environment,cluster,signature,instruction_path,slot,block_time,mint,destination,amount,invoice_id,disposition) VALUES('test','localnet','test-signature','0',123,now(),$1,$2,$3,$4,'paid') RETURNING id",
        [a.mint, a.recipient, a.payable_units, invoiceA],
      )
    ).rows[0];
    await pool.query("UPDATE invoices SET status='paid' WHERE id=$1", [
      invoiceA,
    ]);
    await pool.query(
      "INSERT INTO ledger_entries(invoice_id,transfer_id,amount,asset,entry_type)VALUES($1,$2,$3,'USDC','payment')",
      [invoiceA, transfer.id, a.payable_units],
    );
    await pool.query(
      "INSERT INTO chain_transfers(environment,cluster,signature,instruction_path,slot,block_time,mint,destination,amount,invoice_id,disposition) VALUES('test','localnet','extra-transfer','0',124,now(),$1,$2,999999999,$3,'duplicate_payment')",
      [a.mint, a.recipient, invoiceA],
    );
    await pool.query(
      "INSERT INTO webhook_events(event_id,invoice_id,event_type,payload)VALUES($1,$2,'payment.confirmed','{}')",
      [randomUUID(), invoiceA],
    );
    await pool.query(
      "INSERT INTO admin_sessions(token_hash,environment,cluster,tenant_id,object_id,csrf_token,expires_at)VALUES($1,'test','localnet',$2,$3,'test-csrf',now()+interval '1 hour')",
      [createHash("sha256").update(token).digest("hex"), config.tenant, object],
    );
  });
  afterAll(async () => {
    await app.close();
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  });
  it("requires a live admin session, not a merchant bearer key", async () => {
    for (const url of [
      "/admin/overview",
      "/admin/operations",
      "/admin/projects",
      "/admin/invoices",
    ]) {
      expect((await app.inject({ url })).statusCode).toBe(401);
      expect(
        (
          await app.inject({
            url,
            headers: { authorization: "Bearer merchant-test" },
          })
        ).statusCode,
      ).toBe(401);
    }
    expect(
      (await app.inject({ url: "/admin/projects", headers }))
        .json()
        .items.map((p: { id: string }) => p.id)
        .sort(),
    ).toEqual(projects.slice(0, 2).sort());
  });
  it("counts invoices/review separately and sums credited ledger only per asset", async () => {
    const response = await app.inject({ url: "/admin/overview", headers });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json().counts).toEqual({
      total: "2",
      paid: "1",
      pending: "1",
      confirming: "0",
      expired: "0",
      review: "1",
    });
    expect(response.json().gross_received).toEqual([
      { asset: "USDT", amount: "0.000000" },
      { asset: "USDC", amount: "3.000001" },
    ]);
    const filtered = (
      await app.inject({
        url: `/admin/overview?project_id=${projects[1]}`,
        headers,
      })
    ).json();
    expect(filtered.counts.total).toBe("1");
    expect(
      filtered.gross_received.every(
        (a: { amount: string }) => a.amount === "0.000000",
      ),
    ).toBe(true);
  });
  it("paginates across projects and restricts foreign cursors and detail", async () => {
    const first = (
      await app.inject({ url: "/admin/invoices?limit=1", headers })
    ).json();
    expect(first.items).toHaveLength(1);
    const next = (
      await app.inject({
        url: `/admin/invoices?limit=1&before=${first.next_cursor}`,
        headers,
      })
    ).json();
    expect(next.items).toHaveLength(1);
    expect(next.items[0].id).not.toBe(first.items[0].id);
    expect(next.next_cursor).toBeNull();
    expect(
      (
        await app.inject({
          url: `/admin/invoices?project_id=${projects[0]}`,
          headers,
        })
      )
        .json()
        .items.map((r: { id: string }) => r.id),
    ).toEqual([invoiceA]);
    expect(
      (await app.inject({ url: `/admin/invoices?before=${foreign}`, headers }))
        .statusCode,
    ).toBe(400);
    expect(
      (await app.inject({ url: `/admin/invoices/${foreign}`, headers }))
        .statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ url: `/admin/invoices/${invoiceB}`, headers }))
        .statusCode,
    ).toBe(200);
  });
  it("does not fabricate operational balances when RPC is not configured", async () => {
    const response = await app.inject({ url: "/admin/operations", headers });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: "operations_unavailable" });
  });
  it("returns transfer/event evidence without checkout tokens or secrets", async () => {
    const response = await app.inject({
      url: `/admin/invoices/${invoiceA}`,
      headers,
    });
    expect(response.statusCode).toBe(200);
    const detail = response.json();
    expect(detail.transfers).toHaveLength(2);
    expect(detail.events[0].event_type).toBe("payment.confirmed");
    expect(detail.deliveries).toEqual([]);
    expect(detail.invoice).not.toHaveProperty("checkout_token");
    expect(detail.invoice).not.toHaveProperty("checkout_url");
    expect(detail.attempts).toHaveLength(1);
    expect(detail.has_more).toEqual({
      transfers: false,
      events: false,
      deliveries: false,
    });
  });
  it("rejects invalid queries and revoked role/session access", async () => {
    for (const url of [
      "/admin/invoices?asset=SOL",
      "/admin/invoices?limit=101",
      "/admin/overview?project_id=bad",
      "/admin/invoices?status=paid&unexpected=1",
    ])
      expect((await app.inject({ url, headers })).statusCode).toBe(400);
    delete config.allowed[object];
    expect(
      (await app.inject({ url: "/admin/overview", headers })).statusCode,
    ).toBe(401);
    config.allowed[object] = "operator";
    expect(
      (await app.inject({ url: "/admin/overview", headers })).statusCode,
    ).toBe(200);
    await pool.query("UPDATE admin_sessions SET revoked_at=now()");
    expect(
      (await app.inject({ url: "/admin/invoices", headers })).statusCode,
    ).toBe(401);
  });
});
