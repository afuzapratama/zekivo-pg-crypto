import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { randomUUID, createHash } from "node:crypto";
import { createPool } from "../packages/database/src/pool.js";
import { buildApp } from "../apps/api/src/app.js";
const databaseUrl = process.env.TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)("invoice database/API integration", () => {
  const pool = createPool(databaseUrl!);
  const app = buildApp(
    pool,
    {
      APP_ENV: "test",
      SOLANA_CLUSTER: "localnet",
      WEB_ORIGIN: "http://localhost:3000",
    },
    false,
  );
  const projects = [randomUUID(), randomUUID()];
  const keys = [randomUUID(), randomUUID()];
  beforeAll(async () => {
    for (let i = 0; i < 2; i++) {
      await pool.query(
        "INSERT INTO projects(id,name,environment) VALUES($1,'Integration test','test')",
        [projects[i]],
      );
      await pool.query(
        "INSERT INTO api_keys(id,project_id,key_hash) VALUES($1,$2,$3)",
        [
          randomUUID(),
          projects[i],
          createHash("sha256").update(keys[i]!).digest("hex"),
        ],
      );
    }
  });
  afterAll(async () => {
    for (const id of projects) {
      await pool.query("DELETE FROM idempotency_records WHERE project_id=$1", [
        id,
      ]);
      await pool.query("DELETE FROM audit_logs WHERE project_id=$1", [id]);
      await pool.query("DELETE FROM invoices WHERE project_id=$1", [id]);
      await pool.query("DELETE FROM api_keys WHERE project_id=$1", [id]);
      await pool.query("DELETE FROM projects WHERE id=$1", [id]);
    }
    await app.close();
    await pool.end();
  });
  function request(order: string, key: string, project = 0, amount = "25") {
    return app.inject({
      method: "POST",
      url: "/v1/invoices",
      headers: {
        authorization: `Bearer ${keys[project]}`,
        "idempotency-key": key,
      },
      payload: { order_id: order, asset: "USDC", amount },
    });
  }
  it("replays an identical request and rejects altered payload", async () => {
    const key = randomUUID(),
      order = randomUUID();
    const first = await request(order, key);
    expect(first.statusCode).toBe(201);
    const repeat = await request(order, key);
    expect(repeat.statusCode).toBe(200);
    expect(repeat.json().id).toBe(first.json().id);
    expect((await request(order, key, 0, "26")).statusCode).toBe(409);
  });
  it("limits checkout tokens to one public read-only projection", async () => {
    const created = (await request(randomUUID(), randomUUID())).json();
    const token = new URL(created.checkout_url).pathname.split("/").pop()!;
    for (const candidate of [undefined, "invalid", "a".repeat(43)]) {
      const response = await app.inject({
        url: "/v1/checkout",
        headers: candidate ? { "x-checkout-token": candidate } : {},
      });
      expect(response.statusCode).toBe(404);
      expect(response.headers["cache-control"]).toBe("no-store");
    }
    const response = await app.inject({
      url: "/v1/checkout",
      headers: { "x-checkout-token": token },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      asset: "USDC",
      status: "pending",
      payment_enabled: false,
      recipient: null,
      mint: null,
      review_reasons: [],
    });
    for (const field of [
      "id",
      "project_id",
      "order_id",
      "checkout_token",
      "checkout_url",
    ])
      expect(response.json()).not.toHaveProperty(field);
    const otherEnvironment = buildApp(
      pool,
      {
        APP_ENV: "local",
        SOLANA_CLUSTER: "localnet",
        WEB_ORIGIN: "http://localhost:3100",
      },
      false,
    );
    expect(
      (
        await otherEnvironment.inject({
          url: "/v1/checkout",
          headers: { "x-checkout-token": token },
        })
      ).statusCode,
    ).toBe(404);
    await otherEnvironment.close();
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/checkout",
          headers: { "x-checkout-token": token },
          payload: { status: "paid" },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          url: `/v1/invoices/${created.id}`,
          headers: { "x-checkout-token": token },
        })
      ).statusCode,
    ).toBe(401);
  });
  it("binds merchant quotes to idempotency and rejects duplicate or inconsistent prices", async () => {
    const key = randomUUID(),
      order = randomUUID();
    const send = (options: { asset: string; amount: string }[]) =>
      app.inject({
        method: "POST",
        url: "/v1/invoices",
        headers: { authorization: `Bearer ${keys[0]}`, "idempotency-key": key },
        payload: {
          order_id: order,
          asset: "USDC",
          amount: "5",
          payment_options: options,
        },
      });
    const options = [
      { asset: "USDT", amount: "5.1" },
      { asset: "USDC", amount: "5" },
    ];
    const first = await send(options);
    expect(first.statusCode).toBe(201);
    expect((await send([...options].reverse())).statusCode).toBe(200);
    expect(
      (
        await send([
          { asset: "USDT", amount: "6" },
          { asset: "USDC", amount: "5" },
        ])
      ).statusCode,
    ).toBe(409);
    const token = new URL(first.json().checkout_url).pathname.split("/").pop()!;
    const view = (
      await app.inject({
        url: "/v1/checkout",
        headers: { "x-checkout-token": token },
      })
    ).json();
    expect(view.payment_options).toEqual([
      { asset: "USDC", amount: "5.000000" },
      { asset: "USDT", amount: "5.100000" },
    ]);
    expect(view.invoice_version).toBe(1);
    expect(
      (
        await send([
          { asset: "USDC", amount: "5" },
          { asset: "USDC", amount: "5" },
        ])
      ).statusCode,
    ).toBe(409);
    expect((await send([{ asset: "USDC", amount: "6" }])).statusCode).toBe(409);
  });
  it("allocates distinct totals concurrently across projects", async () => {
    const responses = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        request(randomUUID(), randomUUID(), i % 2),
      ),
    );
    expect(responses.every((r) => r.statusCode === 201)).toBe(true);
    expect(new Set(responses.map((r) => r.json().payable_amount)).size).toBe(
      20,
    );
  });
  it("deduplicates concurrent retries", async () => {
    const key = randomUUID(),
      order = randomUUID();
    const results = await Promise.all(
      Array.from({ length: 8 }, () => request(order, key)),
    );
    expect(new Set(results.map((r) => r.json().id)).size).toBe(1);
    expect(results.filter((r) => r.statusCode === 201)).toHaveLength(1);
  });
  it("does not leak invoices to another project", async () => {
    const result = await request(randomUUID(), randomUUID());
    const response = await app.inject({
      url: `/v1/invoices/${result.json().id}`,
      headers: { authorization: `Bearer ${keys[1]}` },
    });
    expect(response.statusCode).toBe(404);
  });
  it("rejects unauthenticated and invalid amount requests", async () => {
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/invoices",
          payload: { order_id: "x", asset: "USDC", amount: "1" },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (await request(randomUUID(), randomUUID(), 0, "1.0000001")).statusCode,
    ).toBe(400);
  });
  it("does not recycle expired totals or collide across different base prices", async () => {
    const first = await request(randomUUID(), randomUUID(), 0, "71");
    await pool.query(
      "UPDATE invoices SET status='expired', expires_at=now()-interval '1 second' WHERE id=$1",
      [first.json().id],
    );
    const next = await request(randomUUID(), randomUUID(), 1, "71");
    expect(next.json().payable_amount).not.toBe(first.json().payable_amount);
    const near = await request(randomUUID(), randomUUID(), 1, "71.000001");
    expect([
      first.json().payable_amount,
      next.json().payable_amount,
    ]).not.toContain(near.json().payable_amount);
  });
  it("exposes API contracts and never accepts unexpected fields", async () => {
    const spec = await app.inject({ url: "/openapi.json" });
    expect(spec.statusCode).toBe(200);
    expect(spec.json().paths["/v1/invoices"].post).toBeDefined();
    const invalid = await app.inject({
      method: "POST",
      url: "/v1/invoices",
      headers: {
        authorization: `Bearer ${keys[0]}`,
        "idempotency-key": randomUUID(),
      },
      payload: {
        order_id: randomUUID(),
        asset: "USDC",
        amount: "1",
        status: "paid",
      },
    });
    expect(invalid.statusCode).toBe(400);
    expect((await app.inject({ url: "/ready" })).statusCode).toBe(200);
  });
});
