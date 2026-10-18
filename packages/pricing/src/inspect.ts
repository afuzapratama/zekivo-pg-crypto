import { config as dotenv } from "dotenv";
import { fileURLToPath } from "node:url";
import { createPool } from "../../database/src/pool.js";
import { loadPricingConfig } from "./config.js";
import { createProvider } from "./provider.js";
import { createPricingService } from "./service.js";
import { PricingError } from "./errors.js";
import { convertUsdToToken } from "./decimal.js";
const envFile = process.argv.includes("--devnet") ? ".env.devnet" : ".env";
dotenv({
  path: fileURLToPath(new URL(`../../../${envFile}`, import.meta.url)),
  override: true,
  quiet: true,
});
let pool: ReturnType<typeof createPool> | undefined;
try {
  const config = loadPricingConfig(process.env);
  if (!process.env.DATABASE_URL)
    throw new PricingError("configuration_invalid");
  pool = createPool(process.env.DATABASE_URL);
  const service = createPricingService(pool, config, createProvider(config));
  // Second read demonstrates reuse, not a second external refresh.
  for (let n = 0; n < 2; n++) {
    const snapshot = await service.getPrices();
    console.log(
      JSON.stringify({
        event: "pricing.snapshot",
        ...snapshot,
        exampleUsd: "25.83",
        conversions: snapshot.rates.map((r) => ({
          asset: r.asset,
          convertedAmount: convertUsdToToken("25.83", r.usdPerToken)
            .convertedAmount,
        })),
      }),
    );
  }
} catch (error) {
  console.error(
    JSON.stringify({
      event: "pricing.inspect_failed",
      code: error instanceof PricingError ? error.code : "storage_unavailable",
    }),
  );
  process.exitCode = 1;
} finally {
  await pool?.end();
}
