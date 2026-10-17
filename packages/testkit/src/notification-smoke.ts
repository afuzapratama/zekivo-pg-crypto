import { randomBytes, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { createPool } from "../../database/src/pool.js";
import { encryptSecret } from "../../webhooks/src/crypto.js";
import {
  recordNotification,
  dispatchNotification,
} from "../../notifications/src/queue.js";
const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (
  !url ||
  !["localhost", "127.0.0.1", "postgres"].includes(new URL(url).hostname)
)
  throw new Error("Use an explicit local test database URL");
const smtpHost = process.env.MAILPIT_SMTP_HOST ?? "127.0.0.1";
const apiOrigin = process.env.MAILPIT_API_URL ?? "http://127.0.0.1:8025";
const apiUrl = new URL(apiOrigin);
if (
  apiUrl.protocol !== "http:" ||
  !["127.0.0.1", "localhost", "host.docker.internal"].includes(
    apiUrl.hostname,
  ) ||
  apiUrl.port !== "8025" ||
  apiUrl.username ||
  apiUrl.password
)
  throw new Error("Mailpit API must be local port 8025");
const root = createPool(url),
  schema = `notification_smoke_${randomUUID().replaceAll("-", "")}`;
const scoped = new URL(url);
scoped.searchParams.set("options", `-c search_path=${schema}`);
const pool = createPool(scoped.href);
const marker = randomUUID(),
  key = randomBytes(32).toString("hex"),
  scope = {
    APP_ENV: "local",
    SOLANA_CLUSTER: "localnet",
    NOTIFICATION_ENCRYPTION_KEY: key,
  };
try {
  await root.query(`CREATE SCHEMA ${schema}`);
  for (const name of (
    await readdir(new URL("../../database/migrations/", import.meta.url))
  )
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await pool.query(
      await readFile(
        new URL(`../../database/migrations/${name}`, import.meta.url),
        "utf8",
      ),
    );
  const config = {
    mode: "mailpit",
    host: smtpHost,
    port: 1025,
    from: "pg-notifications@example.test",
    to: "admin-notifications@example.test",
  };
  await pool.query(
    "INSERT INTO notification_channels(environment,cluster,channel,enabled,config_ciphertext)VALUES('local','localnet','email',true,$1)",
    [encryptSecret(JSON.stringify(config), key)],
  );
  await recordNotification(
    pool,
    scope,
    marker,
    "notification.test",
    `Mailpit smoke ${marker}`,
    `Queue → SMTP → Mailpit. Fixture ${marker}. No payment changed.`,
  );
  await dispatchNotification(pool, scope);
  const state = (
    await pool.query(
      "SELECT status,attempt_count,last_error FROM notification_deliveries WHERE channel='email'",
    )
  ).rows[0];
  if (state?.status !== "sent")
    throw new Error(`SMTP smoke failed: ${state?.last_error ?? state?.status}`);
  const response = await fetch(
    new URL(
      `/api/v1/search?query=${encodeURIComponent(`subject:${marker}`)}`,
      apiUrl,
    ),
    { signal: AbortSignal.timeout(10000) },
  );
  if (!response.ok)
    throw new Error(`Mailpit search failed: ${response.status}`);
  const data = (await response.json()) as {
    messages?: { ID: string; Subject: string }[];
  };
  const mail = data.messages?.find((m) => m.Subject.includes(marker));
  if (!mail) throw new Error("Smoke message not found in Mailpit");
  const detailResponse = await fetch(
    new URL(`/api/v1/message/${encodeURIComponent(mail.ID)}`, apiUrl),
    { signal: AbortSignal.timeout(10000) },
  );
  const detail = (await detailResponse.json()) as { Text?: string };
  if (!detail.Text?.includes(marker))
    throw new Error("Mailpit message body did not match fixture");
  console.log(
    JSON.stringify({
      event: "notification.mailpit_smoke_passed",
      status: state.status,
      attempt_count: state.attempt_count,
      mailpit_message_id: mail.ID,
      subject: mail.Subject,
      fixture_schema_cleaned: true,
    }),
  );
} finally {
  await pool.end();
  await root.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await root.end();
}
