import { createHash } from "node:crypto";
import type pg from "pg";
import type { PricingConfig } from "./config.js";
import { PricingError } from "./errors.js";
import {
  validateSnapshot,
  type PriceProvider,
  type Snapshot,
} from "./provider.js";
export type PriceResult = Snapshot & {
  cached: boolean;
  fetchedAt: string;
  validUntil: string;
};
export function createPricingService(
  pool: pg.Pool,
  config: PricingConfig,
  provider: PriceProvider,
  clock = Date.now,
) {
  // Same credential/batch shares a lock, cache and usage counter in this database.
  // Fingerprint only: never persist the provider key itself.
  const cacheKey = createHash("sha256")
    .update(
      `pricing-v1:${config.provider}:${config.provider === "fixture" ? "local" : config.apiKey}`,
    )
    .digest("hex");
  let inflight: Promise<PriceResult> | undefined;
  async function load(): Promise<PriceResult> {
    const client = await pool.connect().catch(() => {
      throw new PricingError("storage_unavailable");
    });
    let locked = false;
    try {
      const deadline = performance.now() + 6500;
      do {
        const lock = await client.query(
          "SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked",
          [cacheKey],
        );
        locked = lock.rows[0].locked;
        if (!locked) await new Promise((resolve) => setTimeout(resolve, 100));
      } while (!locked && performance.now() < deadline);
      if (!locked) throw new PricingError("cache_busy");
      const result = await client.query(
        "SELECT * FROM market_price_cache WHERE cache_key=$1",
        [cacheKey],
      );
      const row = result.rows[0];
      const now = clock();
      if (
        row?.snapshot &&
        row.valid_until?.getTime() > now &&
        row.fetched_at?.getTime() + config.cacheTtlSeconds * 1000 > now
      ) {
        try {
          const snapshot = validateSnapshot(
            row.snapshot,
            now,
            config.maxAgeSeconds,
          );
          if (snapshot.source !== config.provider)
            throw new PricingError("invalid_payload");
          return {
            ...snapshot,
            cached: true,
            fetchedAt: row.fetched_at.toISOString(),
            validUntil: row.valid_until.toISOString(),
          };
        } catch {
          /* Expired/invalid source data must be refreshed, never served. */
        }
      }
      if (row?.retry_after?.getTime() > now) throw new PricingError("cooldown");
      if (config.provider !== "fixture") {
        const month = new Date(now).toISOString().slice(0, 7) + "-01";
        // Autocommit reservation BEFORE the external call; failures/crashes consume
        // local budget too. This is not an authoritative account-wide API balance.
        const usage = await client.query(
          `INSERT INTO market_price_usage(cache_key,month,requests) VALUES($1,$2,1)
          ON CONFLICT(cache_key,month) DO UPDATE SET requests=market_price_usage.requests+1
          WHERE market_price_usage.requests<$3 RETURNING requests`,
          [cacheKey, month, config.monthlyBudget],
        );
        if (!usage.rowCount) throw new PricingError("quota_exceeded");
      }
      try {
        const snapshot = validateSnapshot(
          await provider.fetchPrices(),
          clock(),
          config.maxAgeSeconds,
        );
        if (snapshot.source !== config.provider)
          throw new PricingError("invalid_payload");
        const fetchedAt = new Date(clock());
        const sourceLimit = Math.min(
          ...snapshot.rates.map(
            (r) => Date.parse(r.sourceUpdatedAt) + config.maxAgeSeconds * 1000,
          ),
        );
        const validUntil = new Date(
          Math.min(
            fetchedAt.getTime() + config.cacheTtlSeconds * 1000,
            sourceLimit,
          ),
        );
        if (validUntil.getTime() <= fetchedAt.getTime())
          throw new PricingError("stale_price");
        await client.query(
          `INSERT INTO market_price_cache(cache_key,snapshot,fetched_at,valid_until) VALUES($1,$2,$3,$4)
          ON CONFLICT(cache_key) DO UPDATE SET snapshot=$2,fetched_at=$3,valid_until=$4,retry_after=NULL,error_code=NULL,updated_at=now()`,
          [cacheKey, JSON.stringify(snapshot), fetchedAt, validUntil],
        );
        return {
          ...snapshot,
          cached: false,
          fetchedAt: fetchedAt.toISOString(),
          validUntil: validUntil.toISOString(),
        };
      } catch (error) {
        const code =
          error instanceof PricingError ? error.code : "upstream_unavailable";
        await client.query(
          `INSERT INTO market_price_cache(cache_key,retry_after,error_code) VALUES($1,$2,$3)
          ON CONFLICT(cache_key) DO UPDATE SET retry_after=$2,error_code=$3,updated_at=now()`,
          [cacheKey, new Date(clock() + 30_000), code],
        );
        throw new PricingError(code);
      }
    } catch (error) {
      if (error instanceof PricingError) throw error;
      throw new PricingError("storage_unavailable");
    } finally {
      let destroy = false;
      if (locked) {
        try {
          await client.query(
            "SELECT pg_advisory_unlock(hashtextextended($1,0))",
            [cacheKey],
          );
        } catch {
          destroy = true;
        }
      }
      client.release(destroy);
    }
  }
  return {
    async getPrices(): Promise<PriceResult> {
      if (!inflight)
        inflight = load().finally(() => {
          inflight = undefined;
        });
      return structuredClone(await inflight);
    },
  };
}
