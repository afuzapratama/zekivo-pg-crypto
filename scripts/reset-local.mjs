import { spawnSync } from "node:child_process";
if (process.env.APP_ENV && process.env.APP_ENV !== "local")
  throw new Error("Reset is local only");
if (!process.argv.includes("--confirm"))
  throw new Error(
    "Deletes local database and Solana ledger. Run pnpm local:reset --confirm",
  );
const result = spawnSync("docker", ["compose", "down", "--volumes"], {
  stdio: "inherit",
});
process.exit(result.status ?? 1);
