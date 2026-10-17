import {
  collectNotifications,
  dispatchNotification,
  recordNotification,
  scannerHealth,
} from "../packages/notifications/src/queue.js";
import { decryptSecret } from "../packages/webhooks/src/crypto.js";
import { NotificationError } from "../packages/notifications/src/transport.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { createPool } from "../packages/database/src/pool.js";
import { buildApp } from "../apps/api/src/app.js";
import type { AdminAuthConfig } from "../packages/auth/src/config.js";
const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)("admin notifications", () => {
  const root = createPool(url!);
  const schema = `project_test_${randomUUID().replaceAll("-", "")}`;
  const parsed = new URL(url ?? "postgres://unused@localhost/test");
  parsed.searchParams.set("options", `-c search_path=${schema}`);
  const pool = createPool(parsed.href);
  const ids = [randomUUID(), randomUUID(), randomUUID()];
  const tokens = ids.map(() => randomBytes(32).toString("base64url"));
  const csrf = randomBytes(32).toString("base64url");
  const auth: AdminAuthConfig = {
    tenant: randomUUID(),
    clientId: randomUUID(),
    secret: "test-only-secret-unused-oidc",
    origin: "http://localhost:3100",
    allowed: {
      [ids[0]!]: "admin",
      [ids[1]!]: "operator",
      [ids[2]!]: "read-only",
    },
  };
  const app = buildApp(
    pool,
    {
      APP_ENV: "test",
      SOLANA_CLUSTER: "localnet",
      WEB_ORIGIN: auth.origin,
      ADMIN_AUTH: auth,
      NOTIFICATION_ENCRYPTION_KEY: "ab".repeat(32),
    },
    false,
  );
  const headers = (role = 0) => ({
    cookie: `zekivo_test_localnet_session=${tokens[role]}`,
    origin: auth.origin,
    "x-csrf-token": csrf,
    "idempotency-key": randomUUID(),
  });
  const post = (
    url: string,
    payload: Record<string, unknown>,
    extra: Record<string, string> = {},
  ) =>
    app.inject({
      method: "POST",
      url,
      payload,
      headers: { ...headers(), ...extra },
    });

  beforeAll(async () => {
    await root.query(`CREATE SCHEMA ${schema}`);
    for (const file of (await readdir("packages/database/migrations"))
      .filter((f) => f.endsWith(".sql"))
      .sort())
      await pool.query(
        await readFile(`packages/database/migrations/${file}`, "utf8"),
      );
    for (let i = 0; i < 3; i++)
      await pool.query(
        "INSERT INTO admin_sessions(token_hash,environment,cluster,tenant_id,object_id,csrf_token,expires_at,authenticated_at)VALUES($1,'test','localnet',$2,$3,$4,now()+interval '1 hour',now())",
        [
          createHash("sha256").update(tokens[i]!).digest("hex"),
          auth.tenant,
          ids[i],
          csrf,
        ],
      );
  });
  afterAll(async () => {
    await app.close();
    await pool.end();
    await root.query(`DROP SCHEMA ${schema} CASCADE`);
    await root.end();
  });
  const scope = {
    APP_ENV: "test",
    SOLANA_CLUSTER: "localnet",
    NOTIFICATION_ENCRYPTION_KEY: "ab".repeat(32),
  };
  const telegram = {
    bot_token: `123456:${"a".repeat(35)}`,
    chat_id: "-100123456",
  };
  it("queues both channels while unconfigured without attempting sends, and deduplicates events", async () => {
    await recordNotification(
      pool,
      scope,
      "fixture:payment",
      "payment.confirmed",
      "Payment",
      "Invoice UUID",
    );
    await recordNotification(
      pool,
      scope,
      "fixture:payment",
      "payment.confirmed",
      "Payment",
      "Invoice UUID",
    );
    expect(
      (await pool.query("SELECT 1 FROM notification_deliveries")).rowCount,
    ).toBe(2);
    let sends = 0;
    expect(
      await dispatchNotification(pool, scope, async () => {
        sends++;
      }),
    ).toBe(false);
    expect(sends).toBe(0);
    expect(
      (
        await pool.query(
          "SELECT status,attempt_count FROM notification_deliveries",
        )
      ).rows,
    ).toEqual([
      { status: "waiting_configuration", attempt_count: 0 },
      { status: "waiting_configuration", attempt_count: 0 },
    ]);
  });
  it("admin saves encrypted channels once and never returns secret in GET", async () => {
    const key = { "idempotency-key": randomUUID() };
    const body = { enabled: true, expected_version: 0, config: telegram };
    expect(
      (await post("/admin/notifications/telegram", body, key)).statusCode,
    ).toBe(200);
    expect(
      (await post("/admin/notifications/telegram", body, key)).json().replayed,
    ).toBe(true);
    const stored = (
      await pool.query(
        "SELECT version,config_ciphertext FROM notification_channels",
      )
    ).rows[0];
    expect(stored.version).toBe(1);
    expect(stored.config_ciphertext).not.toContain(telegram.bot_token);
    const read = await app.inject({
      url: "/admin/notifications",
      headers: headers(2),
    });
    expect(read.statusCode).toBe(200);
    expect(read.body).not.toContain(telegram.bot_token);
    expect(read.body).not.toContain("ciphertext");
    expect(read.json().channels[0].config.bot_token_set).toBe(true);
    expect(
      (
        await pool.query(
          "SELECT object_id FROM admin_audit_logs WHERE action='notification.save'",
        )
      ).rows,
    ).toEqual([{ object_id: ids[0] }]);
  });
  it("blocks role/CSRF/stale session, validates config and rejects stale versions", async () => {
    const body = {
      enabled: true,
      expected_version: 1,
      config: { ...telegram, bot_token: "" },
    };
    expect(
      (await post("/admin/notifications/telegram", body, headers(1)))
        .statusCode,
    ).toBe(403);
    expect(
      (
        await post("/admin/notifications/telegram", body, {
          "x-csrf-token": "wrong",
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await post("/admin/notifications/telegram", {
          ...body,
          expected_version: 0,
        })
      ).json().error,
    ).toBe("settings_changed");
    expect(
      (
        await post("/admin/notifications/telegram", {
          ...body,
          config: { ...telegram, chat_id: "@arbitrary" },
        })
      ).statusCode,
    ).toBe(400);
    await pool.query(
      "UPDATE admin_sessions SET authenticated_at=now()-interval '11 minutes' WHERE object_id=$1",
      [ids[0]],
    );
    expect(
      (await post("/admin/notifications/telegram/test", {})).json().error,
    ).toBe("reauthentication_required");
    await pool.query(
      "UPDATE admin_sessions SET authenticated_at=now() WHERE object_id=$1",
      [ids[0]],
    );
    expect((await post("/admin/notifications/telegram", body)).statusCode).toBe(
      200,
    );
    expect(
      JSON.parse(
        decryptSecret(
          (
            await pool.query(
              "SELECT config_ciphertext FROM notification_channels",
            )
          ).rows[0].config_ciphertext,
          scope.NOTIFICATION_ENCRYPTION_KEY,
        ),
      ).bot_token,
    ).toBe(telegram.bot_token);
  });
  it("claims once concurrently, records provider acceptance and waits for absent SMTP", async () => {
    let sends = 0;
    const results = await Promise.all([
      dispatchNotification(pool, scope, async () => {
        sends++;
      }),
      dispatchNotification(pool, scope, async () => {
        sends++;
      }),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(sends).toBe(1);
    const rows = (
      await pool.query(
        "SELECT channel,status,attempt_count FROM notification_deliveries ORDER BY channel",
      )
    ).rows;
    expect(rows).toEqual([
      { channel: "email", status: "waiting_configuration", attempt_count: 0 },
      { channel: "telegram", status: "sent", attempt_count: 1 },
    ]);
    expect(
      (await pool.query("SELECT finished_at FROM notification_attempts"))
        .rows[0].finished_at,
    ).toBeTruthy();
  });
  it("test messages use selected channel only and repeated requests do not enqueue twice", async () => {
    const key = { "idempotency-key": randomUUID() };
    expect(
      (await post("/admin/notifications/telegram/test", {}, key)).json().status,
    ).toBe("queued");
    expect(
      (await post("/admin/notifications/telegram/test", {}, key)).json()
        .replayed,
    ).toBe(true);
    expect(
      (
        await pool.query(
          "SELECT d.channel FROM notification_deliveries d JOIN notification_events e ON e.id=d.event_id WHERE e.event_type='notification.test'",
        )
      ).rows,
    ).toEqual([{ channel: "telegram" }]);
  });
  it("retries sanitized errors, respects provider retry delay and expires unsent backlog", async () => {
    await dispatchNotification(pool, scope, async () => {
      throw new NotificationError("telegram_rate_limited", 120);
    });
    const failed = (
      await pool.query(
        "SELECT * FROM notification_deliveries WHERE last_error='telegram_rate_limited'",
      )
    ).rows[0];
    expect(failed.status).toBe("pending");
    expect(
      new Date(failed.next_attempt_at).getTime() - Date.now(),
    ).toBeGreaterThan(110000);
    await pool.query(
      "UPDATE notification_deliveries SET expires_at=now()-interval '1 second' WHERE status IN ('pending','waiting_configuration')",
    );
    expect(
      await dispatchNotification(pool, scope, async () => {
        throw new Error("must not send");
      }),
    ).toBe(false);
    expect(
      (
        await pool.query(
          "SELECT 1 FROM notification_deliveries WHERE status='expired'",
        )
      ).rowCount,
    ).toBe(2);
  });
  it("collects new transfers only and deduplicates scanner failure/recovery alerts", async () => {
    await collectNotifications(pool, scope);
    await pool.query(
      "INSERT INTO chain_transfers(environment,cluster,signature,instruction_path,slot,block_time,mint,destination,amount,disposition)VALUES('test','localnet','notify-fixture','0',123,now(),'mint','ata',1,'unmatched')",
    );
    await collectNotifications(pool, scope);
    await collectNotifications(pool, scope);
    expect(
      (
        await pool.query(
          "SELECT 1 FROM notification_events WHERE event_type='transfer.review'",
        )
      ).rowCount,
    ).toBe(1);
    await scannerHealth(pool, scope, "failed");
    await scannerHealth(pool, scope, "failed");
    await scannerHealth(pool, scope, "healthy");
    expect(
      (
        await pool.query(
          "SELECT event_type FROM notification_events WHERE event_type LIKE 'scanner.%' ORDER BY id",
        )
      ).rows.map((r) => r.event_type),
    ).toEqual(["scanner.failed", "scanner.recovered"]);
    const foreign = { ...scope, SOLANA_CLUSTER: "devnet" };
    expect(
      await dispatchNotification(pool, foreign, async () => {
        throw new Error("cross cluster");
      }),
    ).toBe(false);
  });
  it("rejects Mailpit in non-local environments and requires a new password when SMTP host changes", async () => {
    expect(
      (
        await post("/admin/notifications/email", {
          enabled: true,
          expected_version: 0,
          config: {
            mode: "mailpit",
            host: "127.0.0.1",
            port: 1025,
            from: "pg@example.com",
            to: "admin@example.com",
          },
        })
      ).statusCode,
    ).toBe(400);
    const config = {
      host: "smtp.example.com",
      port: 587,
      username: "pg",
      password: "fixture-only",
      from: "pg@example.com",
      to: "admin@example.com",
    };
    expect(
      (
        await post("/admin/notifications/email", {
          enabled: false,
          expected_version: 0,
          config,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await post("/admin/notifications/email", {
          enabled: true,
          expected_version: 1,
          config: { ...config, host: "other.example.com", password: "" },
        })
      ).statusCode,
    ).toBe(400);
  });
});
