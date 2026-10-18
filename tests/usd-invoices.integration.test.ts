import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { randomUUID, createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { createPool } from "../packages/database/src/pool.js";
import { createUsdInvoice } from "../packages/pricing/src/invoices.js";
import {
  checkoutInvoice,
  selectAsset,
} from "../packages/database/src/checkout.js";
import { buildApp } from "../apps/api/src/app.js";
import type { Snapshot } from "../packages/pricing/src/provider.js";
const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)("USD invoice persistence and API", () => {
  const admin = createPool(url!);
  const schema = "usd_" + randomUUID().replaceAll("-", "");
  const parsed = new URL(url ?? "postgres://unused@localhost/test");
  parsed.searchParams.set("options", `-c search_path=${schema}`);
  const pool = createPool(parsed.href);
  const project = randomUUID();
  const key = randomUUID();
  const input = {
    order_id: "usd-order",
    price_currency: "USD" as const,
    price_amount: "25.83",
    payment_asset: "USDT" as const,
    allowed_payment_assets: ["USDT", "USDC"] as ("USDT" | "USDC")[],
    network: "solana" as const,
    expires_in_seconds: 900,
  };
  const fetch = vi.fn(
    async () =>
      ({
        source: "fixture",
        fetchedAt: new Date().toISOString(),
        rates: [
          {
            asset: "USDT",
            marketAssetId: "tether",
            usdPerToken: "0.999",
            sourceUpdatedAt: new Date().toISOString(),
          },
          {
            asset: "USDC",
            marketAssetId: "usd-coin",
            usdPerToken: "1",
            sourceUpdatedAt: new Date().toISOString(),
          },
        ],
      }) as Snapshot & { fetchedAt: string },
  );
  const app = buildApp(
    pool,
    {
      APP_ENV: "test",
      SOLANA_CLUSTER: "localnet",
      WEB_ORIGIN: "http://localhost:3100",
      PRICING: {
        provider: "fixture",
        cacheTtlSeconds: 60,
        maxAgeSeconds: 180,
        monthlyBudget: 9000,
      },
    },
    false,
  );
  beforeAll(async () => {
    await admin.query(`CREATE SCHEMA ${schema}`);
    for (const name of (await readdir("packages/database/migrations"))
      .filter((n) => n.endsWith(".sql"))
      .sort())
      await pool.query(
        await readFile("packages/database/migrations/" + name, "utf8"),
      );
    await pool.query(
      "INSERT INTO projects(id,name,environment)VALUES($1,'USD tests','test')",
      [project],
    );
    await pool.query(
      "INSERT INTO api_keys(id,project_id,key_hash)VALUES($1,$2,$3)",
      [randomUUID(), project, createHash("sha256").update(key).digest("hex")],
    );
  });
  afterAll(async () => {
    await app.close();
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  });
  it("stores original cents and per-asset conversion atomically; retries do not reprice", async () => {
    const a = await createUsdInvoice(
      pool,
      project,
      "test",
      "localnet",
      "usd-key",
      input,
      { getPrices: fetch },
    );
    expect(a.row.price_amount).toBe("25.83");
    expect(a.row.base_units).toBe("25855856");
    expect(a.row.payable_units).toBe("25855857");
    const b = await createUsdInvoice(
      pool,
      project,
      "test",
      "localnet",
      "usd-key",
      input,
      {
        getPrices: async () => {
          throw Error("offline");
        },
      },
    );
    expect(b.replayed).toBe(true);
    expect(b.row.id).toBe(a.row.id);
    expect(fetch).toHaveBeenCalledTimes(1);
    await expect(
      createUsdInvoice(
        pool,
        project,
        "test",
        "localnet",
        "usd-key",
        { ...input, price_amount: "25.84" },
        { getPrices: fetch },
      ),
    ).rejects.toThrow("different request");
    await pool.query("UPDATE invoices SET payment_enabled=true WHERE id=$1", [
      a.row.id,
    ]);
    await pool.query(
      "UPDATE payment_attempts SET payment_enabled=true WHERE invoice_id=$1",
      [a.row.id],
    );
    const before = await checkoutInvoice(
      pool,
      a.row.checkout_token,
      "test",
      "localnet",
      "http://localhost:3100",
    );
    expect(before?.price_amount).toBe("25.83");
    await selectAsset(
      pool,
      a.row.checkout_token,
      "test",
      "localnet",
      "USDC",
      1,
    );
    const after = await checkoutInvoice(
      pool,
      a.row.checkout_token,
      "test",
      "localnet",
      "http://localhost:3100",
    );
    expect(after?.price_amount).toBe("25.83");
    expect(after?.amount).toBe("25.830000");
    expect(
      (after?.quote as { rate_usd_per_token: string }).rate_usd_per_token,
    ).toBe("1");
    expect(after?.expires_at).toEqual(before?.expires_at);
  });
  it("exposes authenticated v2 while v1 rejects USD payloads", async () => {
    const headers = {
      authorization: "Bearer " + key,
      "idempotency-key": "api-usd",
    };
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v2/invoices",
          payload: input,
        })
      ).statusCode,
    ).toBe(401);
    const response = await app.inject({
      method: "POST",
      url: "/v2/invoices",
      headers,
      payload: { ...input, order_id: "api-usd" },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().price_amount).toBe("25.83");
    expect(response.json().amount).toBe("25.830000");
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v2/invoices",
          headers,
          payload: { ...input, order_id: "api-usd" },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/invoices",
          headers,
          payload: input,
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v2/invoices",
          headers,
          payload: { ...input, price_amount: "25.831" },
        })
      ).statusCode,
    ).toBe(400);
  });
});
