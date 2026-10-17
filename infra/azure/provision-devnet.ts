import { createPool } from "../../packages/database/src/pool.js";
import { SolanaRpc } from "../../packages/solana/src/rpc.js";
import { provisionUsdc } from "../../packages/devnet/src/provisioning.js";

// A new Azure database starts at finalized head. Existing Devnet wallet funds
// are recorded as an opening balance, never imported as payments or ledger credit.
const env = process.env;
const database = new URL(env.DATABASE_URL ?? "invalid:");
if (
  env.APP_ENV !== "staging" ||
  env.SOLANA_CLUSTER !== "devnet" ||
  !database.hostname.endsWith(".postgres.database.azure.com") ||
  database.pathname !== "/gateway_staging" ||
  database.searchParams.get("sslmode") !== "verify-full" ||
  !env.STAGING_PROJECT_ID ||
  !env.STAGING_API_KEY ||
  !env.SOLANA_RPC_URL
)
  throw new Error(
    "Provision requires the dedicated Azure staging Devnet configuration",
  );
const pool = createPool(database.href);
try {
  const rpc = new SolanaRpc(env.SOLANA_RPC_URL);
  for (const asset of ["USDC", "USDT"] as const)
    console.log(
      JSON.stringify(
        await provisionUsdc(
          pool,
          rpc,
          env.STAGING_PROJECT_ID,
          env.STAGING_API_KEY,
          asset,
          "record-future-only",
        ),
      ),
    );
} finally {
  await pool.end();
}
