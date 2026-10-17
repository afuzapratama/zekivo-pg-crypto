import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { loadConfig } from "../../config/src/index.js";
import { createPool } from "../../database/src/pool.js";
import { assertLocalRpc, SolanaRpc } from "../../solana/src/rpc.js";
import { validateConfigs, scanAccount } from "../../solana/src/watcher.js";
import type { TokenConfig } from "../../solana/src/decode.js";
import { buildApp } from "../../../apps/api/src/app.js";
const config = loadConfig();
assertLocalRpc(config.SOLANA_RPC_URL, config.APP_ENV, config.SOLANA_CLUSTER);
const pool = createPool(config.DATABASE_URL),
  rpc = new SolanaRpc(config.SOLANA_RPC_URL);
const app = buildApp(pool, { ...config, CHAIN_MONITORING: "true" }, false);
try {
  const configs = (
    await pool.query<TokenConfig>(
      "SELECT * FROM token_configs WHERE environment='local' AND cluster='localnet'",
    )
  ).rows;
  if (configs.length !== 2) throw new Error("Run local:seed-chain first");
  await validateConfigs(rpc, configs);
  for (const [asset, manual, partial] of [
    ["USDT", false, false],
    ["USDC", true, false],
    ["USDT", false, true],
  ] as const) {
    const response = await app.inject({
      method: "POST",
      url: "/v1/invoices",
      headers: {
        authorization: "Bearer zk_local_development_only",
        "idempotency-key": randomUUID(),
      },
      payload: { order_id: `chain-smoke-${randomUUID()}`, asset, amount: "8" },
    });
    if (response.statusCode !== 201)
      throw new Error(`Invoice create failed: ${response.body}`);
    const invoice = response.json();
    if (!invoice.payment_enabled)
      throw new Error("Local payment was not enabled");
    const args = [
      "local:pay",
      invoice.id,
      ...(partial ? ["1"] : []),
      ...(manual ? ["--manual"] : []),
    ];
    console.log(
      JSON.stringify({
        event: "smoke.paying",
        invoice_id: invoice.id,
        asset,
        manual,
        partial,
      }),
    );
    const payment = await promisify(execFile)("pnpm", args, {
      env: process.env,
      timeout: 120000,
    });
    const signature = payment.stdout
      .split("\n")
      .filter((line) => line.startsWith("{"))
      .map((line) => JSON.parse(line) as { signature?: string })
      .find((value) => value.signature)?.signature;
    if (!signature)
      throw new Error("Payment helper did not return a transaction signature");
    const token = configs.find((c) => c.asset === asset)!;
    let result:
      | {
          status: string;
          ledger_entries: number;
          outbox_events: number;
          disposition: string | null;
        }
      | undefined;
    for (let attempt = 0; attempt < 60; attempt++) {
      const scan = await scanAccount(pool, rpc, token);
      if (scan.historyGap)
        console.warn(
          JSON.stringify({
            event: "smoke.local_history_gap",
            ...scan.historyGap,
          }),
        );
      result = (
        await pool.query(
          `SELECT i.status,
        (SELECT count(*)::int FROM ledger_entries l WHERE l.invoice_id=i.id) AS ledger_entries,
        (SELECT count(*)::int FROM webhook_events e WHERE e.invoice_id=i.id) AS outbox_events,
        (SELECT t.disposition FROM chain_transfers t WHERE t.environment='local' AND t.cluster='localnet' AND t.signature=$2 LIMIT 1) AS disposition
        FROM invoices i WHERE i.id=$1`,
          [invoice.id, signature],
        )
      ).rows[0];
      if (result?.disposition) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    if (
      !result ||
      result.status !== (partial ? "pending" : "paid") ||
      result.ledger_entries !== (partial ? 0 : 1) ||
      result.outbox_events !== 1 ||
      result.disposition !== (partial ? "partial" : "paid")
    )
      throw new Error(
        `Unexpected settlement ${JSON.stringify(result)} for ${signature}`,
      );
    // Revisit the overlap window and verify that accounting still stays idempotent.
    await scanAccount(pool, rpc, token);
    const afterReplay = (
      await pool.query(
        `SELECT i.status,
      (SELECT count(*)::int FROM ledger_entries l WHERE l.invoice_id=i.id) AS ledger_entries,
      (SELECT count(*)::int FROM webhook_events e WHERE e.invoice_id=i.id) AS outbox_events
      FROM invoices i WHERE i.id=$1`,
        [invoice.id],
      )
    ).rows[0];
    if (
      afterReplay.status !== result.status ||
      afterReplay.ledger_entries !== result.ledger_entries ||
      afterReplay.outbox_events !== result.outbox_events
    )
      throw new Error("Scan replay changed accounting unexpectedly");
    const state = result.status,
      ledger = result.ledger_entries,
      outbox = result.outbox_events;
    console.log(
      JSON.stringify({
        event: "smoke.passed",
        invoice_id: invoice.id,
        asset,
        manual,
        partial,
        status: state,
        ledger_entries: ledger,
        outbox_events: outbox,
      }),
    );
  }
} finally {
  await app.close();
  await pool.end();
}
