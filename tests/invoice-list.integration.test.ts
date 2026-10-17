import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { createPool } from "../packages/database/src/pool.js";
import { buildApp } from "../apps/api/src/app.js";
const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)("merchant invoice listing", () => {
  const pool = createPool(url!);
  const config = {
    APP_ENV: "test",
    SOLANA_CLUSTER: "localnet",
    WEB_ORIGIN: "http://localhost:3100",
  };
  const app = buildApp(pool, config, false);
  const otherCluster = buildApp(
    pool,
    { ...config, SOLANA_CLUSTER: "devnet" },
    false,
  );
  const projects = [randomUUID(), randomUUID()];
  const keys = [randomUUID(), randomUUID()];
  const ids: string[] = [];
  const headers = { authorization: `Bearer ${keys[0]}` };
  beforeAll(async () => {
    for (let p = 0; p < 2; p++) {
      await pool.query(
        "INSERT INTO projects(id,name,environment) VALUES($1,'List test','test')",
        [projects[p]],
      );
      await pool.query(
        "INSERT INTO api_keys(id,project_id,key_hash) VALUES($1,$2,$3)",
        [
          randomUUID(),
          projects[p],
          createHash("sha256").update(keys[p]!).digest("hex"),
        ],
      );
      for (let n = 0; n < (p === 0 ? 6 : 1); n++) {
        const r = await app.inject({
          method: "POST",
          url: "/v1/invoices",
          headers: {
            authorization: `Bearer ${keys[p]}`,
            "idempotency-key": randomUUID(),
          },
          payload: {
            order_id: `list:${p}:${n}`,
            asset: n % 2 ? "USDT" : "USDC",
            amount: "3",
          },
        });
        expect(r.statusCode).toBe(201);
        if (p === 0) ids.push(r.json().id);
      }
    }
    await pool.query(
      "UPDATE invoices SET created_at='2026-01-01T00:00:00.123456Z' WHERE project_id=$1",
      [projects[0]],
    );
    await pool.query(
      "UPDATE invoices SET created_at='2026-01-01T00:00:00.123455Z',status='paid' WHERE id=$1",
      [ids[0]],
    );
  });
  afterAll(async () => {
    for (const project of projects) {
      await pool.query("DELETE FROM idempotency_records WHERE project_id=$1", [
        project,
      ]);
      await pool.query("DELETE FROM audit_logs WHERE project_id=$1", [project]);
      await pool.query("DELETE FROM invoices WHERE project_id=$1", [project]);
      await pool.query("DELETE FROM api_keys WHERE project_id=$1", [project]);
      await pool.query("DELETE FROM projects WHERE id=$1", [project]);
    }
    await app.close();
    await otherCluster.close();
    await pool.end();
  });
  it("paginates tied timestamps with no skips, preserving database microseconds", async () => {
    const expected = (
      await pool.query(
        "SELECT id FROM invoices WHERE project_id=$1 ORDER BY created_at DESC,id DESC",
        [projects[0]],
      )
    ).rows.map((r) => r.id);
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const response = await app.inject({
        url: `/v1/invoices?limit=2${cursor ? `&before=${cursor}` : ""}`,
        headers,
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers["cache-control"]).toBe("no-store");
      const data: {
        items: { id: string; amount: string; payable_amount: string }[];
        next_cursor: string | null;
      } = response.json();
      seen.push(...data.items.map((row: { id: string }) => row.id));
      cursor = data.next_cursor;
      for (const row of data.items) {
        expect(row.amount).toBe("3.000000");
        expect(typeof row.payable_amount).toBe("string");
        for (const field of [
          "checkout_url",
          "checkout_token",
          "project_id",
          "key_hash",
        ])
          expect(row).not.toHaveProperty(field);
      }
    } while (cursor);
    expect(seen).toEqual(expected);
    expect(new Set(seen).size).toBe(6);
  });
  it("filters status, selected asset and exact order ID", async () => {
    for (const [query, total] of [
      ["status=paid", 1],
      ["asset=USDT", 3],
      ["status=paid&asset=USDT", 0],
      ["order_id=list%3A0%3A2", 1],
      ["order_id=list", 0],
    ] as const) {
      const r = await app.inject({ url: `/v1/invoices?${query}`, headers });
      expect(r.statusCode).toBe(200);
      expect(r.json().items).toHaveLength(total);
      expect(r.json().next_cursor).toBeNull();
    }
  });
  it("scopes list, detail and cursor to project, environment and cluster", async () => {
    const otherHeaders = { authorization: `Bearer ${keys[1]}` };
    expect(
      (await app.inject({ url: "/v1/invoices", headers: otherHeaders })).json()
        .items,
    ).toHaveLength(1);
    expect(
      (
        await app.inject({
          url: `/v1/invoices?before=${ids[0]}`,
          headers: otherHeaders,
        })
      ).json(),
    ).toEqual({ error: "invalid_cursor" });
    expect(
      (
        await app.inject({
          url: `/v1/invoices/${ids[0]}`,
          headers: otherHeaders,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await otherCluster.inject({ url: "/v1/invoices", headers })).json()
        .items,
    ).toEqual([]);
    expect(
      (await otherCluster.inject({ url: `/v1/invoices/${ids[0]}`, headers }))
        .statusCode,
    ).toBe(404);
    expect(
      (
        await otherCluster.inject({
          url: `/v1/invoices?before=${ids[0]}`,
          headers,
        })
      ).statusCode,
    ).toBe(400);
    await pool.query("UPDATE invoices SET environment='staging' WHERE id=$1", [
      ids[0],
    ]);
    try {
      expect(
        (await app.inject({ url: `/v1/invoices/${ids[0]}`, headers }))
          .statusCode,
      ).toBe(404);
      expect(
        (await app.inject({ url: "/v1/invoices", headers })).json().items,
      ).toHaveLength(5);
    } finally {
      await pool.query("UPDATE invoices SET environment='test' WHERE id=$1", [
        ids[0],
      ]);
    }
  });
  it("rejects invalid filters, missing credentials and revoked keys", async () => {
    expect((await app.inject({ url: "/v1/invoices" })).statusCode).toBe(401);
    for (const query of [
      "limit=0",
      "limit=101",
      "limit=abc",
      "before=bad",
      "status=review",
      "asset=SOL",
      "order_id=",
      "unexpected=1",
      `before=${randomUUID()}`,
    ])
      expect(
        (await app.inject({ url: `/v1/invoices?${query}`, headers }))
          .statusCode,
      ).toBe(400);
    await pool.query(
      "UPDATE api_keys SET revoked_at=now() WHERE project_id=$1",
      [projects[1]],
    );
    expect(
      (
        await app.inject({
          url: "/v1/invoices",
          headers: { authorization: `Bearer ${keys[1]}` },
        })
      ).statusCode,
    ).toBe(401);
  });
  it("publishes query and response schemas for Scalar", async () => {
    const spec = (await app.inject({ url: "/openapi.json" })).json();
    const route = spec.paths["/v1/invoices"].get;
    expect(route.security).toEqual([{ merchantKey: [] }]);
    expect(route.parameters.map((p: { name: string }) => p.name)).toEqual(
      expect.arrayContaining([
        "limit",
        "before",
        "asset",
        "status",
        "order_id",
      ]),
    );
    expect(route.responses["200"]).toBeDefined();
  });
});
