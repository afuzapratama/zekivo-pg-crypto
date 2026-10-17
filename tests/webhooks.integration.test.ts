import { describe, it, expect, beforeEach, afterEach, afterAll } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { createPool } from "../packages/database/src/pool.js";
import { createInvoice } from "../packages/database/src/invoices.js";
import {
  enqueueDeliveries,
  dispatchOne,
  claimDelivery,
  finishDelivery,
  replayDelivery,
} from "../packages/webhooks/src/queue.js";
import {
  encryptSecret,
  signWebhook,
  verifyWebhook,
} from "../packages/webhooks/src/crypto.js";
import { buildReceiver } from "../apps/webhook-receiver/src/app.js";
import { buildApp } from "../apps/api/src/app.js";
const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)("webhook queue, merchant receiver and API", () => {
  const pool = createPool(url!),
    key = "a".repeat(64),
    secret = "whsec_test";
  let project: string,
    endpoint: string,
    apiKey: string,
    receiver: ReturnType<typeof buildReceiver>,
    api: ReturnType<typeof buildApp>;
  beforeEach(async () => {
    project = randomUUID();
    endpoint = randomUUID();
    apiKey = randomUUID();
    await pool.query(
      "INSERT INTO projects(id,name,environment) VALUES($1,'Webhook test','test')",
      [project],
    );
    await pool.query(
      "INSERT INTO api_keys(id,project_id,key_hash) VALUES($1,$2,$3)",
      [
        randomUUID(),
        project,
        createHash("sha256").update(apiKey).digest("hex"),
      ],
    );
    await pool.query(
      "INSERT INTO webhook_endpoints(id,project_id,url,kind,secret_ciphertext) VALUES($1,$2,'http://localhost:4200/webhooks/zekivo','local_inbox',$3)",
      [endpoint, project, encryptSecret(secret, key)],
    );
    receiver = buildReceiver(pool, {
      APP_ENV: "test",
      secret,
      controlToken: "control",
      projectId: project,
    });
    api = buildApp(
      pool,
      {
        APP_ENV: "test",
        SOLANA_CLUSTER: "localnet",
        WEB_ORIGIN: "http://localhost:3100",
        WEBHOOK_ENCRYPTION_KEY: key,
      },
      false,
    );
  });
  afterEach(async () => {
    await receiver.close();
    await api.close();
    await pool.query(
      "DELETE FROM webhook_attempts WHERE delivery_id IN (SELECT d.id FROM webhook_deliveries d JOIN webhook_endpoints h ON h.id=d.endpoint_id WHERE h.project_id=$1)",
      [project],
    );
    await pool.query("DELETE FROM webhook_deliveries WHERE endpoint_id=$1", [
      endpoint,
    ]);
    await pool.query("DELETE FROM webhook_endpoints WHERE project_id=$1", [
      project,
    ]);
    await pool.query("DELETE FROM demo_webhook_receipts WHERE project_id=$1", [
      project,
    ]);
    await pool.query("DELETE FROM demo_merchant_orders WHERE project_id=$1", [
      project,
    ]);
    await pool.query(
      "DELETE FROM webhook_events WHERE invoice_id IN (SELECT id FROM invoices WHERE project_id=$1)",
      [project],
    );
    await pool.query("DELETE FROM idempotency_records WHERE project_id=$1", [
      project,
    ]);
    await pool.query("DELETE FROM audit_logs WHERE project_id=$1", [project]);
    await pool.query("DELETE FROM invoices WHERE project_id=$1", [project]);
    await pool.query("DELETE FROM api_keys WHERE project_id=$1", [project]);
    await pool.query("DELETE FROM projects WHERE id=$1", [project]);
  });
  afterAll(() => pool.end());
  async function event() {
    const invoice = (
      await createInvoice(pool, project, "test", "localnet", randomUUID(), {
        order_id: randomUUID(),
        asset: "USDT",
        amount: "8",
      })
    ).row;
    const payload = {
      event_id: randomUUID(),
      project_id: project,
      event_type: "payment.confirmed",
      schema_version: 1,
      occurred_at: new Date().toISOString(),
      data: {
        invoice_id: invoice.id,
        invoice_version: 1,
        order_id: invoice.order_id,
        finality: "finalized",
      },
    };
    await pool.query(
      "INSERT INTO webhook_events VALUES($1,$2,'payment.confirmed',$3,now())",
      [payload.event_id, invoice.id, payload],
    );
    await enqueueDeliveries(pool, "test");
    return {
      invoice,
      payload,
      job: (
        await pool.query("SELECT * FROM webhook_deliveries WHERE event_id=$1", [
          payload.event_id,
        ])
      ).rows[0],
    };
  }
  const deliver: Parameters<typeof dispatchOne>[3] = async (
    _target,
    _env,
    body,
    headers,
  ) => {
    const response = await receiver.inject({
      method: "POST",
      url: "/webhooks/zekivo",
      headers: { "content-type": "application/json", ...headers },
      payload: body,
    });
    return response.statusCode;
  };
  async function row(id: string) {
    return (
      await pool.query("SELECT * FROM webhook_deliveries WHERE id=$1", [id])
    ).rows[0];
  }
  async function control(mode: string) {
    await receiver.inject({
      method: "POST",
      url: "/test/control",
      headers: {
        authorization: "Bearer control",
        "content-type": "application/json",
      },
      payload: JSON.stringify({ mode, remaining: 1 }),
    });
  }
  it("enqueues once and delivers a signed event to exactly one fulfillment", async () => {
    const e = await event();
    await enqueueDeliveries(pool, "test");
    expect(
      (
        await pool.query("SELECT 1 FROM webhook_deliveries WHERE event_id=$1", [
          e.payload.event_id,
        ])
      ).rowCount,
    ).toBe(1);
    await dispatchOne(pool, "test", key, deliver);
    expect((await row(e.job.id)).status).toBe("delivered");
    expect(
      (
        await pool.query(
          "SELECT fulfillment_count FROM demo_merchant_orders WHERE project_id=$1",
          [project],
        )
      ).rows[0].fulfillment_count,
    ).toBe(1);
  });
  it("retries when ACK fails after merchant commit and does not fulfill twice", async () => {
    const e = await event();
    await control("after_commit");
    await dispatchOne(pool, "test", key, deliver);
    expect((await row(e.job.id)).status).toBe("pending");
    expect(await claimDelivery(pool, "test")).toBeNull();
    await pool.query(
      "UPDATE webhook_deliveries SET next_attempt_at=now() WHERE id=$1",
      [e.job.id],
    );
    await dispatchOne(pool, "test", key, deliver);
    expect((await row(e.job.id)).status).toBe("delivered");
    expect(
      (
        await pool.query(
          "SELECT fulfillment_count FROM demo_merchant_orders WHERE project_id=$1",
          [project],
        )
      ).rows[0].fulfillment_count,
    ).toBe(1);
    expect(
      (
        await pool.query(
          "SELECT 1 FROM demo_webhook_receipts WHERE project_id=$1",
          [project],
        )
      ).rowCount,
    ).toBe(1);
  });
  it("claims one delivery under concurrency and fences a crashed worker", async () => {
    const e = await event();
    const claims = await Promise.all(
      Array.from({ length: 6 }, () => claimDelivery(pool, "test")),
    );
    const first = claims.find(Boolean)!;
    expect(claims.filter(Boolean)).toHaveLength(1);
    await pool.query(
      "UPDATE webhook_deliveries SET locked_until=now()-interval '1 second' WHERE id=$1",
      [e.job.id],
    );
    const second = await claimDelivery(pool, "test");
    expect(second.lease_token).not.toBe(first.lease_token);
    expect(await finishDelivery(pool, first, 204, null)).toBe(false);
    expect(await finishDelivery(pool, second, 204, null)).toBe(true);
    expect((await row(e.job.id)).attempt_count).toBe(2);
  });
  it("dead letters after 24 hours and replays with the same event identity", async () => {
    const e = await event();
    await pool.query(
      "UPDATE webhook_deliveries SET cycle_started_at=now()-interval '25 hours' WHERE id=$1",
      [e.job.id],
    );
    expect(await claimDelivery(pool, "test")).toBeNull();
    expect((await row(e.job.id)).status).toBe("dead");
    expect(await replayDelivery(pool, project, e.job.id)).toBe("replayed");
    await dispatchOne(pool, "test", key, deliver);
    const r = await row(e.job.id);
    expect(r.event_id).toBe(e.payload.event_id);
    expect(r.status).toBe("delivered");
    expect(r.replay_count).toBe(1);
  });
  it("replays a successful delivery without duplicating merchant fulfillment", async () => {
    const e = await event();
    await dispatchOne(pool, "test", key, deliver);
    await replayDelivery(pool, project, e.job.id);
    await dispatchOne(pool, "test", key, deliver);
    expect(
      (
        await pool.query(
          "SELECT fulfillment_count FROM demo_merchant_orders WHERE project_id=$1",
          [project],
        )
      ).rows[0].fulfillment_count,
    ).toBe(1);
    expect((await row(e.job.id)).attempt_count).toBe(2);
  });
  it("records HTTP and network errors without changing the payment", async () => {
    const e = await event();
    await dispatchOne(pool, "test", key, async () => {
      throw new Error("private diagnostic must not be persisted");
    });
    expect((await row(e.job.id)).last_error).toBe("delivery_error");
    expect(
      (
        await pool.query("SELECT status FROM invoices WHERE id=$1", [
          e.invoice.id,
        ])
      ).rows[0].status,
    ).toBe("pending");
  });
  it("uses the current rotated secret on the next attempt", async () => {
    const e = await event();
    await pool.query(
      "UPDATE webhook_endpoints SET secret_ciphertext=$2 WHERE id=$1",
      [endpoint, encryptSecret("new-secret", key)],
    );
    await dispatchOne(pool, "test", key, async (_target, _env, body, h) => {
      expect(
        verifyWebhook(
          body,
          "new-secret",
          h["Zekivo-Timestamp"],
          h["Zekivo-Signature"],
        ),
      ).toBe(true);
      return 204;
    });
    expect((await row(e.job.id)).status).toBe("delivered");
  });
  it("rejects invalid signatures and altered duplicate payloads", async () => {
    const e = await event(),
      body = JSON.stringify(e.payload),
      signed = signWebhook(body, secret);
    const headers = {
      "content-type": "application/json",
      "Zekivo-Timestamp": signed.timestamp,
      "Zekivo-Signature": signed.signature,
    };
    expect(
      (
        await receiver.inject({
          method: "POST",
          url: "/webhooks/zekivo",
          headers: { ...headers, "Zekivo-Signature": "0".repeat(64) },
          payload: body,
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await receiver.inject({
          method: "POST",
          url: "/webhooks/zekivo",
          headers,
          payload: body,
        })
      ).statusCode,
    ).toBe(200);
    const altered = JSON.stringify({
        ...e.payload,
        data: { ...e.payload.data, order_id: "changed" },
      }),
      sig = signWebhook(altered, secret);
    expect(
      (
        await receiver.inject({
          method: "POST",
          url: "/webhooks/zekivo",
          headers: {
            ...headers,
            "Zekivo-Signature": sig.signature,
            "Zekivo-Timestamp": sig.timestamp,
          },
          payload: altered,
        })
      ).statusCode,
    ).toBe(409);
  });
  it("receives newer review before older confirmed, fulfills once and never downgrades paid", async () => {
    const e = await event();
    for (const [event_type, invoice_version] of [
      ["payment.review_required", 4],
      ["payment.partial", 2],
      ["payment.confirmed", 3],
      ["payment.expired", 5],
      ["payment.overpaid", 6],
      ["payment.late", 7],
      ["payment.confirmed", 3],
    ] as const) {
      const payload = {
        ...e.payload,
        event_id: randomUUID(),
        event_type,
        data: { ...e.payload.data, invoice_version },
      };
      const body = JSON.stringify(payload),
        sig = signWebhook(body, secret);
      expect(
        (
          await receiver.inject({
            method: "POST",
            url: "/webhooks/zekivo",
            headers: {
              "content-type": "application/json",
              "Zekivo-Timestamp": sig.timestamp,
              "Zekivo-Signature": sig.signature,
            },
            payload: body,
          })
        ).statusCode,
      ).toBe(200);
    }
    const order = (
      await pool.query(
        "SELECT status,last_version,fulfillment_count FROM demo_merchant_orders WHERE project_id=$1 AND order_id=$2",
        [project, e.invoice.order_id],
      )
    ).rows[0];
    expect(order).toEqual({
      status: "paid",
      last_version: 7,
      fulfillment_count: 1,
    });
  });
  it("records stale events without downgrading a fulfilled order", async () => {
    const e = await event();
    for (const payload of [
      { ...e.payload, data: { ...e.payload.data, invoice_version: 2 } },
      {
        ...e.payload,
        event_id: randomUUID(),
        event_type: "payment.expired",
        data: { ...e.payload.data, invoice_version: 1 },
      },
    ]) {
      const body = JSON.stringify(payload),
        sig = signWebhook(body, secret);
      expect(
        (
          await receiver.inject({
            method: "POST",
            url: "/webhooks/zekivo",
            headers: {
              "content-type": "application/json",
              "Zekivo-Timestamp": sig.timestamp,
              "Zekivo-Signature": sig.signature,
            },
            payload: body,
          })
        ).statusCode,
      ).toBe(200);
    }
    const order = (
      await pool.query(
        "SELECT * FROM demo_merchant_orders WHERE project_id=$1",
        [project],
      )
    ).rows[0];
    expect(order.status).toBe("paid");
    expect(order.last_version).toBe(2);
    expect(order.fulfillment_count).toBe(1);
  });
  it("scopes delivery history and replay to the authenticated project", async () => {
    const e = await event();
    const auth = { authorization: `Bearer ${apiKey}` };
    expect(
      (
        await api.inject({ url: "/v1/webhook-deliveries", headers: auth })
      ).json().items[0].id,
    ).toBe(e.job.id);
    expect(
      (await api.inject({ url: "/v1/webhook-endpoints", headers: auth })).body,
    ).not.toContain("secret_ciphertext");
    expect(
      (
        await api.inject({
          method: "POST",
          url: `/v1/webhook-deliveries/${e.job.id}/replay`,
          headers: auth,
        })
      ).statusCode,
    ).toBe(200);
    expect(await replayDelivery(pool, randomUUID(), e.job.id)).toBe(
      "not_found",
    );
    const claimed = await claimDelivery(pool, "test");
    expect(
      (
        await api.inject({
          method: "POST",
          url: `/v1/webhook-deliveries/${claimed.id}/replay`,
          headers: auth,
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await api.inject({
          method: "POST",
          url: "/v1/webhook-endpoints",
          headers: auth,
          payload: { url: "http://127.0.0.1:4200/webhooks/zekivo" },
        })
      ).statusCode,
    ).toBe(400);
  });
  it("retries a receiver failure before commit without creating a receipt early", async () => {
    const e = await event();
    await control("before_commit");
    await dispatchOne(pool, "test", key, deliver);
    expect(
      (
        await pool.query(
          "SELECT 1 FROM demo_webhook_receipts WHERE project_id=$1",
          [project],
        )
      ).rowCount,
    ).toBe(0);
    await pool.query(
      "UPDATE webhook_deliveries SET next_attempt_at=now() WHERE id=$1",
      [e.job.id],
    );
    await dispatchOne(pool, "test", key, deliver);
    expect((await row(e.job.id)).status).toBe("delivered");
  });
  it("rejects an invoice/order identity conflict and rolls back its receipt", async () => {
    const e = await event();
    await dispatchOne(pool, "test", key, deliver);
    const payload = {
      ...e.payload,
      event_id: randomUUID(),
      data: { ...e.payload.data, invoice_id: randomUUID() },
    };
    const body = JSON.stringify(payload),
      sig = signWebhook(body, secret);
    const response = await receiver.inject({
      method: "POST",
      url: "/webhooks/zekivo",
      headers: {
        "content-type": "application/json",
        "Zekivo-Timestamp": sig.timestamp,
        "Zekivo-Signature": sig.signature,
      },
      payload: body,
    });
    expect(response.statusCode).toBe(409);
    expect(
      (
        await pool.query(
          "SELECT 1 FROM demo_webhook_receipts WHERE event_id=$1",
          [payload.event_id],
        )
      ).rowCount,
    ).toBe(0);
  });
});
