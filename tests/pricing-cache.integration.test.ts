import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createPool } from "../packages/database/src/pool.js";
import { createPricingService } from "../packages/pricing/src/service.js";
import { PricingError } from "../packages/pricing/src/errors.js";
import type { Snapshot } from "../packages/pricing/src/provider.js";
import type { PricingConfig } from "../packages/pricing/src/config.js";
const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)("shared PostgreSQL price cache", () => {
  const admin = createPool(url!);
  const schema = "prices_" + randomUUID().replaceAll("-", "");
  const parsed = new URL(url ?? "postgres://unused@localhost/test");
  parsed.searchParams.set("options", `-c search_path=${schema}`);
  const pool = createPool(parsed.href);
  let now = Date.parse("2026-10-18T00:00:00Z");
  const config: PricingConfig = {
    provider: "coingecko-demo",
    apiKey: "test-shared-key",
    cacheTtlSeconds: 60,
    maxAgeSeconds: 180,
    monthlyBudget: 9000,
  };
  const snapshot = (): Snapshot => ({
    source: "coingecko-demo",
    rates: [
      {
        asset: "USDT",
        marketAssetId: "tether",
        usdPerToken: "0.99900000",
        sourceUpdatedAt: new Date(now).toISOString(),
      },
      {
        asset: "USDC",
        marketAssetId: "usd-coin",
        usdPerToken: "1.00000000",
        sourceUpdatedAt: new Date(now).toISOString(),
      },
    ],
  });
  beforeAll(async () => {
    await admin.query(`CREATE SCHEMA ${schema}`);
    await pool.query(
      await readFile(
        "packages/database/migrations/017_market_prices.sql",
        "utf8",
      ),
    );
  });
  beforeEach(async () => {
    now = Date.parse("2026-10-18T00:00:00Z");
    await pool.query("TRUNCATE market_price_cache,market_price_usage");
  });
  afterAll(async () => {
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  });
  it("coalesces independent services and concurrent callers into one provider request", async () => {
    const fetchPrices = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 150));
      return snapshot();
    });
    const services = Array.from({ length: 4 }, () =>
      createPricingService(pool, config, { fetchPrices }, () => now),
    );
    const values = await Promise.all(
      services.flatMap((s) => [s.getPrices(), s.getPrices()]),
    );
    expect(fetchPrices).toHaveBeenCalledTimes(1);
    expect(values.every((v) => v.rates[0]?.usdPerToken === "0.99900000")).toBe(
      true,
    );
    expect(
      (await pool.query("SELECT requests FROM market_price_usage")).rows[0]
        .requests,
    ).toBe(1);
    expect(
      (await pool.query("SELECT cache_key FROM market_price_cache")).rows[0]
        .cache_key,
    ).not.toContain(config.apiKey);
    values[0]!.rates[0]!.usdPerToken = "mutated";
    expect(values[1]!.rates[0]!.usdPerToken).toBe("0.99900000");
  });
  it("refreshes only after TTL and does not serve a snapshot past source freshness", async () => {
    const fetchPrices = vi.fn(async () => snapshot());
    const service = createPricingService(
      pool,
      config,
      { fetchPrices },
      () => now,
    );
    expect((await service.getPrices()).cached).toBe(false);
    now += 59_000;
    expect((await service.getPrices()).cached).toBe(true);
    now += 1001;
    expect((await service.getPrices()).cached).toBe(false);
    expect(fetchPrices).toHaveBeenCalledTimes(2);
    await pool.query(
      "UPDATE market_price_cache SET snapshot=jsonb_set(snapshot,'{rates,0,sourceUpdatedAt}','\"2026-10-17T00:00:00.000Z\"')",
    );
    expect((await service.getPrices()).cached).toBe(false);
    expect(fetchPrices).toHaveBeenCalledTimes(3);
  });
  it("counts failed requests, persists cooldown, and never silently returns stale data", async () => {
    const fetchPrices = vi.fn(async () => {
      throw new PricingError("upstream_rate_limited");
    });
    await expect(
      createPricingService(
        pool,
        config,
        { fetchPrices },
        () => now,
      ).getPrices(),
    ).rejects.toThrow("upstream_rate_limited");
    await expect(
      createPricingService(
        pool,
        config,
        { fetchPrices },
        () => now,
      ).getPrices(),
    ).rejects.toThrow("cooldown");
    expect(fetchPrices).toHaveBeenCalledTimes(1);
    expect(
      (await pool.query("SELECT requests FROM market_price_usage")).rows[0]
        .requests,
    ).toBe(1);
    now += 30_001;
    await expect(
      createPricingService(
        pool,
        config,
        { fetchPrices },
        () => now,
      ).getPrices(),
    ).rejects.toThrow("upstream_rate_limited");
    expect(fetchPrices).toHaveBeenCalledTimes(2);
  });
  it("stops new provider calls at the monthly local budget and renews in UTC month", async () => {
    const fetchPrices = vi.fn(async () => snapshot());
    const service = createPricingService(
      pool,
      { ...config, monthlyBudget: 1 },
      { fetchPrices },
      () => now,
    );
    await service.getPrices();
    now += 60_001;
    await expect(service.getPrices()).rejects.toThrow("quota_exceeded");
    expect(fetchPrices).toHaveBeenCalledTimes(1);
    now = Date.parse("2026-11-01T00:00:00Z");
    await service.getPrices();
    expect(fetchPrices).toHaveBeenCalledTimes(2);
  });
  it("caps cache expiry by the actual publication age", async () => {
    const data = snapshot();
    data.rates[0]!.sourceUpdatedAt = new Date(now - 170_000).toISOString();
    const service = createPricingService(
      pool,
      config,
      { fetchPrices: async () => data },
      () => now,
    );
    const value = await service.getPrices();
    expect(Date.parse(value.validUntil) - now).toBe(10_000);
    now += 10_001;
    await expect(service.getPrices()).rejects.toThrow("stale_price");
  });
  it("releases the shared lock after provider errors so another caller can recover", async () => {
    await expect(
      createPricingService(
        pool,
        config,
        {
          fetchPrices: async () => {
            throw new Error("private upstream detail");
          },
        },
        () => now,
      ).getPrices(),
    ).rejects.toThrow("upstream_unavailable");
    now += 30_001;
    expect(
      (
        await createPricingService(
          pool,
          config,
          { fetchPrices: async () => snapshot() },
          () => now,
        ).getPrices()
      ).cached,
    ).toBe(false);
  });
});
