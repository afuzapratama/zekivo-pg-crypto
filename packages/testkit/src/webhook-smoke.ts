import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { loadConfig } from "../../config/src/index.js";
import { assertLocalRpc } from "../../solana/src/rpc.js";
import { resolveTarget } from "../../webhooks/src/transport.js";
const config = loadConfig();
assertLocalRpc(config.SOLANA_RPC_URL, config.APP_ENV, config.SOLANA_CLUSTER);
const inboxUrl = process.env.LOCAL_WEBHOOK_URL;
if (!inboxUrl)
  throw new Error(
    "LOCAL_WEBHOOK_URL missing; update local environment configuration",
  );
await resolveTarget({ url: inboxUrl, kind: "local_inbox" }, config.APP_ENV);
const receiverOrigin = new URL(inboxUrl).origin,
  apiOrigin = `http://127.0.0.1:${config.PORT}`;
async function api(path: string, payload?: unknown) {
  const response = await fetch(apiOrigin + path, {
    method: payload ? "POST" : "GET",
    headers: {
      authorization: "Bearer zk_local_development_only",
      "content-type": "application/json",
      "idempotency-key": randomUUID(),
    },
    ...(payload ? { body: JSON.stringify(payload) } : {}),
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`Gateway HTTP ${response.status}`);
  return response.json();
}
async function receiver(path: string, payload?: unknown) {
  const response = await fetch(receiverOrigin + path, {
    method: payload ? "POST" : "GET",
    headers: {
      authorization: `Bearer ${process.env.LOCAL_RECEIVER_CONTROL_TOKEN ?? "local_receiver_control_only"}`,
      "content-type": "application/json",
    },
    ...(payload ? { body: JSON.stringify(payload) } : {}),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`Receiver HTTP ${response.status}`);
  return response.json();
}
async function waitDelivered(invoiceId: string, minAttempts: number) {
  for (let i = 0; i < 180; i++) {
    const list = await api(`/v1/webhook-deliveries?invoice_id=${invoiceId}`);
    const job = list.items[0];
    if (job?.status === "dead")
      throw new Error(`Webhook dead letter: ${job.last_error}`);
    if (job?.status === "delivered" && job.attempt_count >= minAttempts)
      return job;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(
    `Webhook delivery timeout for invoice ${invoiceId}; inspect delivery history`,
  );
}
async function assertOneFulfillment(invoiceId: string) {
  const inbox = await receiver(`/test/inbox?invoice_id=${invoiceId}`);
  if (
    inbox.receipts.length !== 1 ||
    inbox.orders[0]?.fulfillment_count !== 1 ||
    inbox.orders[0]?.status !== "paid"
  )
    throw new Error("Merchant receipt/fulfillment was not exactly once");
}
for (const [asset, mode] of [
  ["USDT", "none"],
  ["USDC", "timeout_after_commit"],
] as const) {
  try {
    await receiver("/test/control", {
      mode,
      remaining: mode === "none" ? 0 : 1,
    });
    const invoice = await api("/v1/invoices", {
      order_id: `webhook-smoke-${randomUUID()}`,
      asset,
      amount: "9",
    });
    if (!invoice.payment_enabled)
      throw new Error("Enabled local invoice required");
    console.log(
      JSON.stringify({
        event: "webhook_smoke.paying",
        invoice_id: invoice.id,
        asset,
        mode,
      }),
    );
    await promisify(execFile)(
      "pnpm",
      ["local:pay", invoice.id, ...(asset === "USDC" ? ["--manual"] : [])],
      { env: process.env, timeout: 120000 },
    );
    const delivered = await waitDelivered(invoice.id, mode === "none" ? 1 : 2);
    await assertOneFulfillment(invoice.id);
    if (mode === "timeout_after_commit") {
      const attempts = await api(
        `/v1/webhook-deliveries/${delivered.id}/attempts`,
      );
      if (
        !attempts.items.some(
          (a: { error_code: string }) => a.error_code === "timeout",
        )
      )
        throw new Error("Expected actual HTTP timeout was not recorded");
    }
    await api(`/v1/webhook-deliveries/${delivered.id}/replay`, {});
    const replayed = await waitDelivered(
      invoice.id,
      delivered.attempt_count + 1,
    );
    await assertOneFulfillment(invoice.id);
    console.log(
      JSON.stringify({
        event: "webhook_smoke.passed",
        invoice_id: invoice.id,
        asset,
        mode,
        event_id: replayed.event_id,
        attempt_count: replayed.attempt_count,
        fulfillment_count: 1,
      }),
    );
  } finally {
    await receiver("/test/control", { mode: "none", remaining: 0 });
  }
}
