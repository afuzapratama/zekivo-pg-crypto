import { config } from "dotenv";
import { fileURLToPath } from "node:url";
export function devnetEnvironment() {
  const result =
    process.env.APP_ENV === "staging" &&
    process.env.DATABASE_URL &&
    process.env.DEVNET_API_KEY
      ? {}
      : config({
          path: fileURLToPath(new URL("../../../.env.devnet", import.meta.url)),
          override: true,
          quiet: true,
        });
  if ("error" in result && result.error)
    throw new Error("Run pnpm devnet:init first");
  const env = process.env;
  if (
    env.APP_ENV !== "staging" ||
    env.SOLANA_CLUSTER !== "devnet" ||
    !["USDC", "USDT,USDC"].includes(env.ENABLED_ASSETS ?? "") ||
    !env.DEVNET_API_KEY ||
    !env.DEVNET_PROJECT_ID
  )
    throw new Error("Expected isolated staging/Devnet configuration");
  return env;
}
