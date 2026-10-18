import { z } from "zod";
import { PricingError } from "./errors.js";
const schema = z.object({
  provider: z.enum(["fixture", "coingecko-demo"]),
  apiKey: z.string().trim().min(1).max(256).optional(),
  cacheTtlSeconds: z.coerce.number().int().min(60).max(120).default(60),
  maxAgeSeconds: z.coerce.number().int().min(60).max(180).default(180),
  monthlyBudget: z.coerce.number().int().min(1).max(9000).default(9000),
});
export type PricingConfig = z.infer<typeof schema>;
export function loadPricingConfig(env: NodeJS.ProcessEnv): PricingConfig {
  if (
    !(
      ["local", "test"].includes(env.APP_ENV ?? "") &&
      env.SOLANA_CLUSTER === "localnet"
    ) &&
    !(env.APP_ENV === "staging" && env.SOLANA_CLUSTER === "devnet")
  )
    throw new PricingError("configuration_invalid");
  const result = schema.safeParse({
    provider:
      env.PRICING_PROVIDER ??
      (env.APP_ENV === "staging" ? "coingecko-demo" : "fixture"),
    apiKey: env.COINGECKO_DEMO_API_KEY || undefined,
    cacheTtlSeconds: env.PRICING_CACHE_TTL_SECONDS,
    maxAgeSeconds: env.PRICING_MAX_AGE_SECONDS,
    monthlyBudget: env.PRICING_MONTHLY_BUDGET,
  });
  if (
    !result.success ||
    (result.data.provider === "coingecko-demo" && !result.data.apiKey)
  )
    throw new PricingError("configuration_invalid");
  // Never propagate Zod input/errors: the input can contain an API credential.
  return result.data;
}
