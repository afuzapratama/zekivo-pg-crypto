import { randomUUID } from "node:crypto";
import type pg from "pg";
import { decryptSecret } from "../../webhooks/src/crypto.js";
import { parseChannel, mailpitAllowed } from "./config.js";
import { NotificationError, sendNotification } from "./transport.js";
export type NotificationScope = {
  APP_ENV: string;
  SOLANA_CLUSTER: string;
  NOTIFICATION_ENCRYPTION_KEY?: string;
  LOCAL_MAILPIT_ENABLED?: string;
};
export async function recordNotification(
  db: Pick<pg.Pool, "query"> | pg.PoolClient,
  scope: NotificationScope,
  key: string,
  type: string,
  title: string,
  body: string,
) {
  const result = await db.query(
    `WITH event AS (INSERT INTO notification_events(environment,cluster,source_key,event_type,title,body)VALUES($1,$2,$3,$4,$5,$6)ON CONFLICT DO NOTHING RETURNING id) INSERT INTO notification_deliveries(event_id,channel)SELECT event.id,c FROM event CROSS JOIN unnest(ARRAY['email','telegram'])c RETURNING id::text`,
    [scope.APP_ENV, scope.SOLANA_CLUSTER, key, type, title, body],
  );
  return result.rows;
}
export async function collectNotifications(
  pool: pg.Pool,
  scope: NotificationScope,
) {
  const env = [scope.APP_ENV, scope.SOLANA_CLUSTER];
  await pool.query(
    "INSERT INTO notification_sources(environment,cluster)VALUES($1,$2)ON CONFLICT DO NOTHING",
    env,
  );
  const baseline = (
    await pool.query(
      "SELECT started_at FROM notification_sources WHERE environment=$1 AND cluster=$2",
      env,
    )
  ).rows[0].started_at;
  const rows = (
    await pool.query(
      `SELECT source_key,event_type,title,body FROM (
 SELECT 'payment:'||e.event_id::text AS source_key,'payment.confirmed' AS event_type,'Pembayaran confirmed' AS title,'Invoice '||i.id::text||' · '||i.asset||' · nominal '||(i.payable_units::numeric/1000000)::text||' · project '||i.project_id::text AS body,e.created_at AS at FROM webhook_events e JOIN invoices i ON i.id=e.invoice_id WHERE i.environment=$1 AND i.cluster=$2 AND e.event_type='payment.confirmed' AND e.created_at>=$3
 UNION ALL SELECT 'review:'||t.id::text,'transfer.review','Transfer perlu review','Transfer #'||t.id::text||' · '||t.disposition||' · mint '||t.mint,t.created_at FROM chain_transfers t WHERE t.environment=$1 AND t.cluster=$2 AND t.disposition<>'paid' AND t.created_at>=$3
 UNION ALL SELECT 'webhook:'||d.id::text||':'||d.replay_count::text,'webhook.dead','Webhook gagal permanen','Delivery #'||d.id::text||' · invoice '||i.id::text,d.cycle_started_at FROM webhook_deliveries d JOIN webhook_events e ON e.event_id=d.event_id JOIN invoices i ON i.id=e.invoice_id WHERE i.environment=$1 AND i.cluster=$2 AND d.status='dead' AND (d.cycle_started_at>=$3 OR EXISTS(SELECT 1 FROM webhook_attempts a WHERE a.delivery_id=d.id AND a.finished_at>=$3))
 )sources WHERE NOT EXISTS(SELECT 1 FROM notification_events n WHERE n.environment=$1 AND n.cluster=$2 AND n.source_key=sources.source_key) ORDER BY at,source_key LIMIT 100`,
      [...env, baseline],
    )
  ).rows;
  for (const row of rows)
    await recordNotification(
      pool,
      scope,
      row.source_key,
      row.event_type,
      row.title,
      row.body,
    );
  const health = (
    await pool.query(
      "SELECT scanner_status,updated_at<now()-interval '120 seconds' AS stalled FROM worker_health WHERE environment=$1 AND cluster=$2",
      env,
    )
  ).rows[0];
  if (health?.scanner_status !== "disabled" && health?.stalled)
    await recordNotification(
      pool,
      scope,
      `scanner_stalled:${Math.floor(Date.now() / 3600000)}`,
      "scanner.stalled",
      "Scanner tidak memperbarui status",
      "Tidak ada pembaruan worker lebih dari 120 detik. Periksa worker dan RPC.",
    );
}
export async function scannerHealth(
  pool: pg.Pool,
  scope: NotificationScope,
  status: "healthy" | "failed" | "disabled",
) {
  const old = (
    await pool.query(
      "SELECT scanner_status FROM worker_health WHERE environment=$1 AND cluster=$2",
      [scope.APP_ENV, scope.SOLANA_CLUSTER],
    )
  ).rows[0];
  await pool.query(
    `INSERT INTO worker_health(environment,cluster,scanner_status,last_success_at,last_error_at)VALUES($1,$2,$3,CASE WHEN $3='healthy' THEN now() END,CASE WHEN $3='failed' THEN now() END)ON CONFLICT(environment,cluster)DO UPDATE SET scanner_status=$3,last_success_at=CASE WHEN $3='healthy' THEN now() ELSE worker_health.last_success_at END,last_error_at=CASE WHEN $3='failed' THEN now() ELSE worker_health.last_error_at END,updated_at=now()`,
    [scope.APP_ENV, scope.SOLANA_CLUSTER, status],
  );
  if (status === "failed")
    await recordNotification(
      pool,
      scope,
      `scanner_failed:${Math.floor(Date.now() / 3600000)}`,
      "scanner.failed",
      "Pemindaian blockchain gagal",
      "Worker gagal menyelesaikan pemindaian. Periksa status scanner dan koneksi RPC.",
    );
  if (status === "healthy" && old?.scanner_status === "failed")
    await recordNotification(
      pool,
      scope,
      `scanner_recovered:${Math.floor(Date.now() / 3600000)}`,
      "scanner.recovered",
      "Scanner pulih",
      "Pemindaian blockchain kembali selesai setelah gangguan.",
    );
}
export async function dispatchNotification(
  pool: pg.Pool,
  scope: NotificationScope,
  transport: typeof sendNotification = sendNotification,
) {
  const client = await pool.connect();
  let job:
    | {
        id: string;
        event_id: string;
        channel: string;
        attempt_count: number;
        lease_token: string;
        config_ciphertext: string;
        environment: string;
        cluster: string;
        title: string;
        body: string;
      }
    | undefined;
  try {
    await client.query("BEGIN");
    await client.query(
      `WITH expired AS (UPDATE notification_deliveries d SET status='expired',lease_token=NULL,locked_until=NULL,last_error='notification_expired' FROM notification_events e WHERE d.event_id=e.id AND e.environment=$1 AND e.cluster=$2 AND d.expires_at<=now() AND (d.status IN ('pending','waiting_configuration') OR (d.status='inflight' AND d.locked_until<=now())) RETURNING d.id) UPDATE notification_attempts a SET finished_at=now(),error_code='notification_expired' FROM expired WHERE a.delivery_id=expired.id AND a.finished_at IS NULL`,
      [scope.APP_ENV, scope.SOLANA_CLUSTER],
    );
    await client.query(
      `WITH lost AS (UPDATE notification_deliveries d SET status=CASE WHEN d.attempt_count>=10 THEN 'dead' ELSE 'pending' END,lease_token=NULL,locked_until=NULL,last_error='lease_expired' FROM notification_events e WHERE d.event_id=e.id AND e.environment=$1 AND e.cluster=$2 AND d.status='inflight' AND d.locked_until<=now() RETURNING d.id) UPDATE notification_attempts a SET finished_at=now(),error_code='lease_expired' FROM lost WHERE a.delivery_id=lost.id AND a.finished_at IS NULL`,
      [scope.APP_ENV, scope.SOLANA_CLUSTER],
    );
    if (!scope.NOTIFICATION_ENCRYPTION_KEY) {
      await client.query(
        `UPDATE notification_deliveries d SET status='waiting_configuration' FROM notification_events e WHERE d.event_id=e.id AND e.environment=$1 AND e.cluster=$2 AND d.status='pending'`,
        [scope.APP_ENV, scope.SOLANA_CLUSTER],
      );
      await client.query("COMMIT");
      return false;
    }
    await client.query(
      `UPDATE notification_deliveries d SET status=CASE WHEN EXISTS(SELECT 1 FROM notification_channels c WHERE c.environment=e.environment AND c.cluster=e.cluster AND c.channel=d.channel AND c.enabled) THEN 'pending' ELSE 'waiting_configuration' END FROM notification_events e WHERE d.event_id=e.id AND e.environment=$1 AND e.cluster=$2 AND d.status IN ('pending','waiting_configuration')`,
      [scope.APP_ENV, scope.SOLANA_CLUSTER],
    );
    job = (
      await client.query(
        `SELECT d.*,e.environment,e.cluster,e.title,e.body,c.config_ciphertext FROM notification_deliveries d JOIN notification_events e ON e.id=d.event_id JOIN notification_channels c ON c.environment=e.environment AND c.cluster=e.cluster AND c.channel=d.channel AND c.enabled WHERE e.environment=$1 AND e.cluster=$2 AND d.expires_at>now() AND ((d.status='pending' AND d.next_attempt_at<=now()) OR (d.status='inflight' AND d.locked_until<=now())) ORDER BY d.next_attempt_at,d.id FOR UPDATE OF d SKIP LOCKED LIMIT 1`,
        [scope.APP_ENV, scope.SOLANA_CLUSTER],
      )
    ).rows[0];
    if (!job) {
      await client.query("COMMIT");
      return false;
    }
    job.lease_token = randomUUID();
    job.attempt_count++;
    await client.query(
      "UPDATE notification_attempts SET finished_at=now(),error_code='lease_expired' WHERE delivery_id=$1 AND finished_at IS NULL",
      [job.id],
    );
    await client.query(
      "UPDATE notification_deliveries SET status='inflight',lease_token=$2,locked_until=now()+interval '90 seconds',attempt_count=$3 WHERE id=$1",
      [job.id, job.lease_token, job.attempt_count],
    );
    await client.query(
      "INSERT INTO notification_attempts(delivery_id,attempt_no)VALUES($1,$2)",
      [job.id, job.attempt_count],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  let errorCode: string | null = null,
    retryAfter = 0;
  try {
    const config = parseChannel(
      job.channel,
      JSON.parse(
        decryptSecret(
          job.config_ciphertext,
          scope.NOTIFICATION_ENCRYPTION_KEY!,
        ),
      ),
    );
    await transport(job.channel, config, {
      id: String(job.event_id),
      environment: job.environment,
      cluster: job.cluster,
      title: job.title,
      body: job.body,
      allowLocalMailpit: mailpitAllowed(scope),
    });
  } catch (error) {
    errorCode =
      error instanceof NotificationError
        ? error.code
        : "notification_delivery_failed";
    retryAfter = error instanceof NotificationError ? error.retryAfter : 0;
  }
  const finish = await pool.connect();
  try {
    await finish.query("BEGIN");
    const updated = await finish.query(
      `UPDATE notification_deliveries SET status=CASE WHEN $3::text IS NULL THEN 'sent' WHEN attempt_count>=10 THEN 'dead' ELSE 'pending' END,sent_at=CASE WHEN $3::text IS NULL THEN now() END,last_error=$3,next_attempt_at=now()+$4*interval '1 second',lease_token=NULL,locked_until=NULL WHERE id=$1 AND lease_token=$2 AND status='inflight' AND locked_until>now() RETURNING id`,
      [
        job.id,
        job.lease_token,
        errorCode,
        Math.max(
          retryAfter,
          Math.min(3600, 30 * 2 ** Math.min(job.attempt_count - 1, 10)),
        ),
      ],
    );
    if (updated.rowCount)
      await finish.query(
        "UPDATE notification_attempts SET finished_at=now(),error_code=$3 WHERE delivery_id=$1 AND attempt_no=$2",
        [job.id, job.attempt_count, errorCode],
      );
    await finish.query("COMMIT");
  } catch (error) {
    await finish.query("ROLLBACK");
    throw error;
  } finally {
    finish.release();
  }
  return true;
}
