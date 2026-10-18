import { describe, it, expect, vi } from "vitest";
import { loadPricingConfig } from "../packages/pricing/src/config.js";
import {
  convertUsdToToken,
  normalizeDecimal,
} from "../packages/pricing/src/decimal.js";
import {
  createProvider,
  validateSnapshot,
} from "../packages/pricing/src/provider.js";
import type { PricingConfig } from "../packages/pricing/src/config.js";
const now = Date.parse("2026-10-18T00:00:00Z");
const config: PricingConfig = {
  provider: "coingecko-demo",
  apiKey: "test-only-key",
  cacheTtlSeconds: 60,
  maxAgeSeconds: 180,
  monthlyBudget: 9000,
};
function payload(price = "0.99900000", time = String(now / 1000)) {
  return `{"tether":{"usd":${price},"last_updated_at":${time}},"usd-coin":{"usd":1.000000000000000001,"last_updated_at":${time}}}`;
}
function provider(text: string, status = 200) {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response(text, { status }));
  return { adapter: createProvider(config, fetcher, () => now), fetcher };
}
describe("USD reference prices", () => {
  it("preserves numeric JSON lexemes and pins market IDs/header/HTTPS endpoint", async () => {
    const { adapter, fetcher } = provider(payload());
    const result = await adapter.fetchPrices();
    expect(result.rates.map((r) => r.usdPerToken)).toEqual([
      "0.99900000",
      "1.000000000000000001",
    ]);
    const [url, options] = fetcher.mock.calls[0]!;
    expect(String(url)).toBe(
      "https://api.coingecko.com/api/v3/simple/price?ids=tether,usd-coin&vs_currencies=usd&include_last_updated_at=true&precision=full",
    );
    expect(options?.headers).toEqual({
      "x-cg-demo-api-key": "test-only-key",
      accept: "application/json",
    });
    expect(options?.redirect).toBe("error");
  });
  it("calculates cents to six decimals with upward rounding, no unique adjustment", () => {
    expect(convertUsdToToken("25.83", "0.999")).toEqual({
      convertedUnits: 25855856n,
      convertedAmount: "25.855856",
    });
    expect(convertUsdToToken("25.83", "1").convertedAmount).toBe("25.830000");
    expect(convertUsdToToken("0.01", "1.001").convertedAmount).toBe("0.009991");
    expect(convertUsdToToken("0.01", "0.99").convertedAmount).toBe("0.010102");
    expect(normalizeDecimal("999e-3")).toBe("0.999");
    expect(normalizeDecimal("1.000000000000000001")).toBe(
      "1.000000000000000001",
    );
  });
  it.each([
    "0.00",
    "25.831",
    "25.8",
    "025.83",
    "-25.83",
    "1e3",
    "NaN",
    "10000000000.00",
  ])("rejects invalid USD cents %s", (value) => {
    expect(() => convertUsdToToken(value, "1")).toThrow("invalid_amount");
  });
  it("enforces the existing token amount limit after conversion", () => {
    expect(() => convertUsdToToken("9999999999.99", "0.99")).toThrow(
      "invalid_amount",
    );
  });
  it.each(["0.98999999", "1.01000001", "0.000001"])(
    "rejects depegged reference %s",
    async (price) => {
      await expect(
        provider(payload(price)).adapter.fetchPrices(),
      ).rejects.toThrow("depeg");
    },
  );
  it.each([String(now / 1000 - 181), String(now / 1000 + 31)])(
    "rejects stale or future source time %s",
    async (time) => {
      await expect(
        provider(payload("1", time)).adapter.fetchPrices(),
      ).rejects.toThrow("stale_price");
    },
  );
  it.each([
    "{}",
    "null",
    "not-json",
    '{"tether":{"usd":1}}',
    payload("0"),
    payload("1e99"),
    payload("1", "1.1"),
  ])("rejects incomplete or malformed payload", async (text) => {
    await expect(provider(text).adapter.fetchPrices()).rejects.toThrow(
      "invalid_payload",
    );
  });
  it("rejects oversized responses", async () => {
    await expect(
      provider(" ".repeat(65537)).adapter.fetchPrices(),
    ).rejects.toThrow("invalid_payload");
  });
  it("sanitizes upstream bodies and fetch errors rather than exposing credentials", async () => {
    await expect(
      provider("secret body test-only-key", 429).adapter.fetchPrices(),
    ).rejects.toThrow("upstream_rate_limited");
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("test-only-key private request"));
    await expect(
      createProvider(config, fetcher, () => now).fetchPrices(),
    ).rejects.toThrow(/^Pricing unavailable: upstream_unavailable$/);
  });
  it("provides deterministic local fixtures without a network call", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const snapshot = await createProvider(
      { ...config, provider: "fixture", apiKey: undefined },
      fetcher,
      () => now,
    ).fetchPrices();
    expect(snapshot.source).toBe("fixture");
    expect(snapshot.rates.every((r) => r.usdPerToken === "1.00000000")).toBe(
      true,
    );
    expect(fetcher).not.toHaveBeenCalled();
    expect(() =>
      validateSnapshot(
        { ...snapshot, rates: [snapshot.rates[0], snapshot.rates[0]] },
        now,
        180,
      ),
    ).toThrow("invalid_payload");
  });
  it("requires a valid environment/key and prevents sub-minute cache settings", () => {
    const staging = {
      APP_ENV: "staging",
      SOLANA_CLUSTER: "devnet",
      COINGECKO_DEMO_API_KEY: "test-key",
    };
    expect(loadPricingConfig(staging).provider).toBe("coingecko-demo");
    expect(() =>
      loadPricingConfig({ ...staging, COINGECKO_DEMO_API_KEY: "" }),
    ).toThrow("configuration_invalid");
    expect(() =>
      loadPricingConfig({ ...staging, PRICING_CACHE_TTL_SECONDS: "59" }),
    ).toThrow("configuration_invalid");
    expect(() =>
      loadPricingConfig({ ...staging, APP_ENV: "production" }),
    ).toThrow("configuration_invalid");
    expect(() =>
      loadPricingConfig({ ...staging, SOLANA_CLUSTER: "mainnet-beta" }),
    ).toThrow("configuration_invalid");
  });
});
