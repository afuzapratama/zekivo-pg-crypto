import { assertStableRate, normalizeDecimal } from "./decimal.js";
import { PricingError } from "./errors.js";
import type { PricingConfig } from "./config.js";
export const MARKET_IDS = { USDT: "tether", USDC: "usd-coin" } as const;
export type Rate = {
  asset: "USDT" | "USDC";
  marketAssetId: string;
  usdPerToken: string;
  sourceUpdatedAt: string;
};
export type Snapshot = { source: PricingConfig["provider"]; rates: Rate[] };
export type PriceProvider = { fetchPrices(): Promise<Snapshot> };

export function validateSnapshot(
  value: unknown,
  now: number,
  maxAgeSeconds: number,
): Snapshot {
  const data = value as Snapshot | null;
  if (
    !data ||
    !["fixture", "coingecko-demo"].includes(data.source) ||
    !Array.isArray(data.rates) ||
    data.rates.length !== 2
  )
    throw new PricingError("invalid_payload");
  for (const asset of ["USDT", "USDC"] as const) {
    const matches = data.rates.filter((r) => r?.asset === asset);
    const rate = matches[0];
    if (
      matches.length !== 1 ||
      !rate ||
      rate.marketAssetId !== MARKET_IDS[asset] ||
      typeof rate.usdPerToken !== "string" ||
      typeof rate.sourceUpdatedAt !== "string"
    )
      throw new PricingError("invalid_payload");
    try {
      assertStableRate(rate.usdPerToken);
    } catch (error) {
      if (error instanceof PricingError && error.code === "depeg") throw error;
      throw new PricingError("invalid_payload");
    }
    const time = Date.parse(rate.sourceUpdatedAt);
    if (
      !Number.isFinite(time) ||
      time > now + 30_000 ||
      time < now - maxAgeSeconds * 1000
    )
      throw new PricingError("stale_price");
  }
  return data;
}

// JSON.parse reviver source context (Node 24) preserves numeric lexemes before
// normalization. Using the parsed JS number would silently lose precision.
function losslessJson(text: string): unknown {
  return JSON.parse(
    text,
    (_key, value: unknown, context?: { source: string }) => {
      if (typeof value !== "number") return value;
      if (!context?.source) throw new PricingError("invalid_payload");
      return context.source;
    },
  );
}
async function readLimited(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new PricingError("invalid_payload");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 65536) throw new PricingError("invalid_payload");
      chunks.push(part.value);
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally {
    await reader.cancel().catch(() => {});
  }
}
export function createProvider(
  config: PricingConfig,
  fetcher: typeof fetch = fetch,
  clock = Date.now,
): PriceProvider {
  return {
    async fetchPrices() {
      if (config.provider === "fixture")
        return validateSnapshot(
          {
            source: "fixture",
            rates: (["USDT", "USDC"] as const).map((asset) => ({
              asset,
              marketAssetId: MARKET_IDS[asset],
              usdPerToken: "1.00000000",
              sourceUpdatedAt: new Date(clock()).toISOString(),
            })),
          },
          clock(),
          config.maxAgeSeconds,
        );
      if (!config.apiKey) throw new PricingError("configuration_invalid");
      try {
        const response = await fetcher(
          "https://api.coingecko.com/api/v3/simple/price?ids=tether,usd-coin&vs_currencies=usd&include_last_updated_at=true&precision=full",
          {
            headers: {
              "x-cg-demo-api-key": config.apiKey,
              accept: "application/json",
            },
            signal: AbortSignal.timeout(5000),
            redirect: "error",
          },
        );
        if (!response.ok) {
          await response.body?.cancel();
          throw new PricingError(
            response.status === 429
              ? "upstream_rate_limited"
              : "upstream_unavailable",
          );
        }
        const payload = losslessJson(await readLimited(response)) as Record<
          string,
          { usd?: unknown; last_updated_at?: unknown }
        > | null;
        const rates = (["USDT", "USDC"] as const).map((asset): Rate => {
          const item = payload?.[MARKET_IDS[asset]];
          if (
            typeof item?.usd !== "string" ||
            typeof item.last_updated_at !== "string" ||
            !/^\d{1,12}$/.test(item.last_updated_at)
          )
            throw new PricingError("invalid_payload");
          return {
            asset,
            marketAssetId: MARKET_IDS[asset],
            usdPerToken: normalizeDecimal(item.usd),
            sourceUpdatedAt: new Date(
              Number(item.last_updated_at) * 1000,
            ).toISOString(),
          };
        });
        return validateSnapshot(
          { source: "coingecko-demo", rates },
          clock(),
          config.maxAgeSeconds,
        );
      } catch (error) {
        if (error instanceof PricingError && error.code !== "invalid_amount")
          throw error;
        // Never include upstream bodies, request headers, URLs or native causes.
        throw new PricingError(
          error instanceof SyntaxError ||
            error instanceof RangeError ||
            error instanceof PricingError
            ? "invalid_payload"
            : "upstream_unavailable",
        );
      }
    },
  };
}
