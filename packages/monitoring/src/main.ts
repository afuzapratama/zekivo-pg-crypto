import pg from "pg";
import { randomUUID } from "node:crypto";
import { loadConfig } from "../../config/src/index.js";
import { SolanaRpc } from "../../solana/src/rpc.js";
import { dispatchNotification } from "../../notifications/src/queue.js";
import { chainReader, runReconciliation } from "./reconciliation.js";
import { checkUptime, probeApi } from "./status.js";
const config = loadConfig(),
  pool = new pg.Pool({
    connectionString: config.DATABASE_URL,
    max: 5,
    connectionTimeoutMillis: 5000,
    query_timeout: 15000,
    statement_timeout: 10000,
  });
const reader = chainReader(
    new SolanaRpc(config.SOLANA_RPC_URL, { retries: 0 }),
    config.ENABLED_ASSETS,
  ),
  instance = randomUUID();
const apiUrl = process.env.MONITOR_API_URL ?? "http://127.0.0.1:4100";
const parsed = new URL(apiUrl);
if (
  !["http:", "https:"].includes(parsed.protocol) ||
  parsed.username ||
  parsed.password ||
  parsed.pathname !== "/"
)
  throw new Error("Monitor API URL must be an origin without credentials");
let stopping = false;
for (const signal of ["SIGTERM", "SIGINT"])
  process.once(signal, () => {
    stopping = true;
  });
const pause = async () => {
  for (let n = 0; n < 30 && !stopping; n++)
    await new Promise((r) => setTimeout(r, 1000));
};
async function uptimeLoop() {
  while (!stopping) {
    try {
      const apiOk = await probeApi(apiUrl, config);
      await checkUptime(
        pool,
        config,
        apiOk,
        config.CHAIN_MONITORING === "true",
      );
      await pool.query(
        "INSERT INTO monitor_heartbeats(environment,cluster,instance_id)VALUES($1,$2,$3)ON CONFLICT(environment,cluster)DO UPDATE SET instance_id=$3,started_at=CASE WHEN monitor_heartbeats.instance_id=$3 THEN monitor_heartbeats.started_at ELSE now() END,updated_at=now()",
        [config.APP_ENV, config.SOLANA_CLUSTER, instance],
      );
      for (let n = 0; n < 3 && !stopping; n++)
        if (!(await dispatchNotification(pool, config))) break;
    } catch {
      console.error(
        JSON.stringify({
          service: "monitor",
          event: "uptime.iteration_failed",
        }),
      );
    }
    await pause();
  }
}
async function reconcileLoop() {
  while (!stopping) {
    try {
      await runReconciliation(pool, config, reader);
    } catch {
      console.error(
        JSON.stringify({
          service: "monitor",
          event: "reconciliation.iteration_failed",
        }),
      );
    }
    await pause();
  }
}
console.log(
  JSON.stringify({
    service: "monitor",
    status: "started",
    environment: config.APP_ENV,
    cluster: config.SOLANA_CLUSTER,
  }),
);
await Promise.all([uptimeLoop(), reconcileLoop()]);
await pool.end();
