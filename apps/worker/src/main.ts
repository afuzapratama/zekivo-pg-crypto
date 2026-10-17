import { expireInvoices } from "../../../packages/database/src/expire.js";
import {
  collectNotifications,
  dispatchNotification,
  scannerHealth,
} from "../../../packages/notifications/src/queue.js";
import {
  enqueueDeliveries,
  dispatchOne,
} from "../../../packages/webhooks/src/queue.js";
import { assertEnabledAssets } from "../../../packages/solana/src/networks.js";
import { SolanaRpc } from "../../../packages/solana/src/rpc.js";
import {
  validateConfigs,
  scanAccount,
} from "../../../packages/solana/src/watcher.js";
import type { TokenConfig } from "../../../packages/solana/src/decode.js";
import { loadConfig } from "../../../packages/config/src/index.js";
import { createPool } from "../../../packages/database/src/pool.js";
const config = loadConfig();
const pool = createPool(config.DATABASE_URL);
const rpc = new SolanaRpc(config.SOLANA_RPC_URL);
let stopping = false;
for (const signal of ["SIGTERM", "SIGINT"])
  process.once(signal, () => {
    stopping = true;
  });
console.log(
  JSON.stringify({
    service: "worker",
    status: "started",
    cluster: config.SOLANA_CLUSTER,
    chain_monitoring: config.CHAIN_MONITORING === "true",
  }),
);
async function webhookLoop() {
  while (!stopping) {
    if (config.WEBHOOK_DELIVERY === "true") {
      try {
        await enqueueDeliveries(pool, config.APP_ENV);
        for (let count = 0; count < 10 && !stopping; count++)
          if (
            !(await dispatchOne(
              pool,
              config.APP_ENV,
              config.WEBHOOK_ENCRYPTION_KEY!,
            ))
          )
            break;
      } catch {
        console.error(
          JSON.stringify({
            service: "worker",
            event: "webhook.iteration_failed",
          }),
        );
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}
async function notificationLoop() {
  while (!stopping) {
    try {
      await collectNotifications(pool, config);
      for (let n = 0; n < 5 && !stopping; n++)
        if (!(await dispatchNotification(pool, config))) break;
    } catch {
      console.error(
        JSON.stringify({
          service: "worker",
          event: "notification.iteration_failed",
        }),
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}
const notificationTask = notificationLoop();
const webhookTask = webhookLoop();
while (!stopping) {
  try {
    if (config.CHAIN_MONITORING === "true") {
      const tokens = await pool.query<TokenConfig>(
        "SELECT * FROM token_configs WHERE environment=$1 AND cluster=$2",
        [config.APP_ENV, config.SOLANA_CLUSTER],
      );
      assertEnabledAssets(tokens.rows, config.ENABLED_ASSETS);
      await validateConfigs(rpc, tokens.rows);
      for (const token of tokens.rows) {
        const result = await scanAccount(pool, rpc, token);
        if (result.historyGap)
          console.warn(
            JSON.stringify({
              service: "worker",
              event: "scanner.local_history_gap",
              token_account: token.token_account,
              ...result.historyGap,
              scanned_through_slot: result.scannedThroughSlot,
            }),
          );
      }
    }
    await scannerHealth(
      pool,
      config,
      config.CHAIN_MONITORING === "true" ? "healthy" : "disabled",
    );
    const result = await expireInvoices(pool, config);
    if (result.rowCount)
      console.log(
        JSON.stringify({
          service: "worker",
          event: "invoices.expired",
          count: result.rowCount,
        }),
      );
  } catch (error) {
    try {
      await scannerHealth(pool, config, "failed");
    } catch {
      /* Database failures cannot be queued until connectivity returns. */
    }
    console.error(
      JSON.stringify({
        service: "worker",
        event: "iteration.failed",
        reason: error instanceof Error ? error.message : "Unknown worker error",
      }),
    );
  }
  await new Promise((resolve) => setTimeout(resolve, config.SCAN_INTERVAL_MS));
}
await webhookTask;
await notificationTask;
await pool.end();
