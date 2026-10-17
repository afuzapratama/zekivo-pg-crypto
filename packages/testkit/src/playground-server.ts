import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../../config/src/index.js";
import { createPool } from "../../database/src/pool.js";
import { assertLocalRpc } from "../../solana/src/rpc.js";
import { buildPlayground } from "./playground.js";
const config = loadConfig();
assertLocalRpc(config.SOLANA_RPC_URL, config.APP_ENV, config.SOLANA_CLUSTER);
const token = process.env.LOCAL_PLAYGROUND_TOKEN;
if (!token || token.length < 20)
  throw new Error("Local playground control token required");
const pool = createPool(config.DATABASE_URL);
const lock = await pool.connect();
if (
  !(await lock.query("SELECT pg_try_advisory_lock(70106) AS locked")).rows[0]
    .locked
)
  throw new Error("Only one local playground runner is allowed");
await pool.query(
  "UPDATE playground_actions SET status='unknown',updated_at=now() WHERE status='pending'",
);
const run = promisify(execFile);
const app = buildPlayground(
  pool,
  {
    environment: config.APP_ENV,
    cluster: config.SOLANA_CLUSTER,
    token,
    apiUrl: process.env.LOCAL_GATEWAY_URL ?? "http://127.0.0.1:4100",
    apiKey: "zk_local_development_only",
  },
  async (id, args) => {
    const result = await run(
      process.execPath,
      [
        "--import",
        "tsx",
        fileURLToPath(new URL("./pay-invoice.ts", import.meta.url)),
        id,
        ...args,
      ],
      {
        cwd: fileURLToPath(new URL("../../../", import.meta.url)),
        timeout: 120000,
        maxBuffer: 16384,
      },
    );
    const lines = result.stdout.trim().split("\n");
    const transaction = JSON.parse(
      lines.find((line) => line.startsWith('{"signature"')) ?? "null",
    );
    if (!transaction?.signature)
      throw new Error("No finalized transaction result");
    return transaction.signature;
  },
);
await app.listen({ port: 4300, host: config.HOST });
console.log(
  JSON.stringify({
    service: "local-playground",
    status: "started",
    cluster: "localnet",
  }),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => {
    void app.close().finally(async () => {
      await lock.query("SELECT pg_advisory_unlock(70106)");
      lock.release();
      await pool.end();
    });
  });
