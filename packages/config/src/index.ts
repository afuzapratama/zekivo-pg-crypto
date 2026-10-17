import { adminAuthConfig } from "../../auth/src/config.js";
import { config as loadDotenv } from "dotenv";
import { fileURLToPath } from "node:url";
// Workspace scripts run from apps/*; always resolve the root environment file.
loadDotenv({
  path: fileURLToPath(new URL("../../../.env", import.meta.url)),
  quiet: true,
});
import { z } from "zod";
const schema = z.object({
  APP_ENV: z.enum(["local", "test", "staging", "production"]).default("local"),
  SOLANA_CLUSTER: z
    .enum(["localnet", "devnet", "mainnet-beta"])
    .default("localnet"),
  SOLANA_RPC_URL: z.string().url().default("http://127.0.0.1:8899"),
  ENABLED_ASSETS: z.enum(["USDT,USDC", "USDC", "USDT"]).default("USDT,USDC"),
  SCAN_INTERVAL_MS: z.coerce.number().int().min(1000).max(60000).default(1000),
  CHAIN_MONITORING: z.enum(["true", "false"]).default("false"),
  WEBHOOK_DELIVERY: z.enum(["true", "false"]).default("false"),
  WEBHOOK_ENCRYPTION_KEY: z
    .string()
    .regex(/^[a-f0-9]{64}$/i)
    .optional(),
  NOTIFICATION_ENCRYPTION_KEY: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z
      .string()
      .regex(/^[a-f0-9]{64}$/i)
      .optional(),
  ),
  LOCAL_MAILPIT_ENABLED: z.enum(["true", "false"]).default("false"),
  DATABASE_URL: z.string().url(),
  PORT: z.coerce.number().int().min(1).max(65535).default(4100),
  HOST: z.string().default("127.0.0.1"),
  WEB_ORIGIN: z.string().url().default("http://localhost:3100"),
});
export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const config = schema.parse(env);
  if (
    config.APP_ENV === "production" ||
    config.SOLANA_CLUSTER === "mainnet-beta"
  ) {
    throw new Error("Production/mainnet is disabled in the foundation release");
  }
  if (config.APP_ENV === "staging" && config.SOLANA_CLUSTER !== "devnet")
    throw new Error("Staging requires devnet");
  if (config.WEBHOOK_DELIVERY === "true" && !config.WEBHOOK_ENCRYPTION_KEY)
    throw new Error("Webhook encryption key required");
  if (config.APP_ENV === "staging" && config.SCAN_INTERVAL_MS < 5000)
    throw new Error("Staging scanner interval must be at least 5000ms");
  return {
    ...config,
    ADMIN_AUTH: adminAuthConfig({ ...env, WEB_ORIGIN: config.WEB_ORIGIN }),
  };
}
