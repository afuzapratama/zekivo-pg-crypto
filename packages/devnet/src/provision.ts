import { devnetEnvironment } from "./environment.js";
import { createPool } from "../../database/src/pool.js";
import { SolanaRpc } from "../../solana/src/rpc.js";
import { provisionUsdc } from "./provisioning.js";
const env = devnetEnvironment();
const pool = createPool(env.DATABASE_URL!);
try {
  const db = await pool.query("SELECT current_database() AS name");
  if (db.rows[0].name !== "gateway_devnet")
    throw new Error("Provision requires the dedicated gateway_devnet database");
  for (const asset of process.argv.includes("--usdt")
    ? ["USDT" as const]
    : env.ENABLED_ASSETS === "USDT,USDC"
      ? ["USDC" as const, "USDT" as const]
      : ["USDC" as const])
    console.log(
      JSON.stringify(
        await provisionUsdc(
          pool,
          new SolanaRpc(env.SOLANA_RPC_URL!),
          env.DEVNET_PROJECT_ID!,
          env.DEVNET_API_KEY!,
          asset,
        ),
      ),
    );
} finally {
  await pool.end();
}
