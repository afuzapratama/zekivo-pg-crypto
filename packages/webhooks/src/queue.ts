import { randomUUID } from "node:crypto";
import type pg from "pg";
import { decryptSecret, signWebhook } from "./crypto.js";
import { sendWebhook, type DeliveryTarget } from "./transport.js";
export async function enqueueDeliveries(pool: pg.Pool, environment: string) {
  // Endpoint registration is prospective: historical events require explicit operator tooling.
  return pool.query(
    `INSERT INTO webhook_deliveries(event_id,endpoint_id)
  SELECT e.event_id,h.id FROM webhook_events e JOIN invoices i ON i.id=e.invoice_id
  JOIN webhook_endpoints h ON h.project_id=i.project_id AND h.active AND h.created_at<=e.created_at
  WHERE i.environment=$1 ON CONFLICT DO NOTHING`,
    [environment],
  );
}
export async function claimDelivery(pool: pg.Pool, environment: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `WITH expired AS (UPDATE webhook_deliveries d SET status='dead',lease_token=NULL,locked_until=NULL,last_error='delivery_window_expired'
   FROM webhook_endpoints h,projects p WHERE d.endpoint_id=h.id AND h.project_id=p.id AND p.environment=$1
   AND (d.status='pending' OR (d.status='inflight' AND d.locked_until<=now())) AND d.cycle_started_at<=now()-interval '24 hours' RETURNING d.id)
   UPDATE webhook_attempts a SET finished_at=now(),error_code='delivery_window_expired' FROM expired WHERE a.delivery_id=expired.id AND a.finished_at IS NULL`,
      [environment],
    );
    const result = await client.query(
      `SELECT d.* FROM webhook_deliveries d JOIN webhook_endpoints h ON h.id=d.endpoint_id JOIN projects p ON p.id=h.project_id
   WHERE p.environment=$1 AND h.active AND d.cycle_started_at>now()-interval '24 hours' AND ((d.status='pending' AND d.next_attempt_at<=now()) OR (d.status='inflight' AND d.locked_until<=now()))
   ORDER BY d.next_attempt_at,d.id FOR UPDATE OF d SKIP LOCKED LIMIT 1`,
      [environment],
    );
    if (!result.rows[0]) {
      await client.query("COMMIT");
      return null;
    }
    const id = result.rows[0].id,
      token = randomUUID();
    await client.query(
      "UPDATE webhook_attempts SET finished_at=now(),error_code='lease_expired' WHERE delivery_id=$1 AND finished_at IS NULL",
      [id],
    );
    const job = (
      await client.query(
        `UPDATE webhook_deliveries SET status='inflight',lease_token=$2,locked_until=now()+interval '45 seconds',attempt_count=attempt_count+1,cycle_attempt_count=cycle_attempt_count+1 WHERE id=$1 RETURNING *`,
        [id, token],
      )
    ).rows[0];
    await client.query(
      "INSERT INTO webhook_attempts(delivery_id,attempt_no) VALUES($1,$2)",
      [id, job.attempt_count],
    );
    const detail = (
      await client.query(
        "SELECT h.url,h.kind,h.secret_ciphertext,e.payload,e.event_id FROM webhook_endpoints h JOIN webhook_events e ON e.event_id=$2 WHERE h.id=$1",
        [job.endpoint_id, job.event_id],
      )
    ).rows[0];
    await client.query("COMMIT");
    return { ...job, ...detail };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
export function retryDelaySeconds(attempt: number, jitter = Math.random()) {
  return (
    Math.min(3600, 10 * 2 ** Math.min(Math.max(attempt - 1, 0), 12)) *
    (0.8 + Math.max(0, Math.min(1, jitter)) * 0.2)
  );
}
export async function finishDelivery(
  pool: pg.Pool,
  job: {
    id: string;
    lease_token: string;
    attempt_count: number;
    cycle_attempt_count: number;
  },
  status: number | null,
  error: string | null,
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `SELECT * FROM webhook_deliveries WHERE id=$1 AND lease_token=$2 AND status='inflight' AND locked_until>now() FOR UPDATE`,
      [job.id, job.lease_token],
    );
    if (!result.rows[0]) {
      await client.query("COMMIT");
      return false;
    }
    const success = status !== null && status >= 200 && status < 300 && !error;
    await client.query(
      "UPDATE webhook_attempts SET finished_at=now(),http_status=$3,error_code=$4 WHERE delivery_id=$1 AND attempt_no=$2",
      [job.id, job.attempt_count, status, error],
    );
    await client.query(
      `UPDATE webhook_deliveries SET status=CASE WHEN $2 THEN 'delivered' WHEN cycle_started_at<=now()-interval '24 hours' THEN 'dead' ELSE 'pending' END,
   next_attempt_at=now()+$3*interval '1 second',last_http_status=$4,last_error=$5,delivered_at=CASE WHEN $2 THEN now() ELSE NULL END,lease_token=NULL,locked_until=NULL WHERE id=$1`,
      [
        job.id,
        success,
        retryDelaySeconds(job.cycle_attempt_count),
        status,
        error,
      ],
    );
    await client.query("COMMIT");
    return true;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
export async function dispatchOne(
  pool: pg.Pool,
  environment: string,
  key: string,
  transport: typeof sendWebhook = sendWebhook,
) {
  const job = await claimDelivery(pool, environment);
  if (!job) return false;
  let status: number | null = null,
    error: string | null = null;
  try {
    const body = JSON.stringify(job.payload),
      signed = signWebhook(body, decryptSecret(job.secret_ciphertext, key));
    status = await transport(
      { url: job.url, kind: job.kind } as DeliveryTarget,
      environment,
      body,
      {
        "Zekivo-Timestamp": signed.timestamp,
        "Zekivo-Signature": signed.signature,
        "Zekivo-Event-Id": job.event_id,
      },
    );
    if (status < 200 || status >= 300) error = `http_${status}`;
  } catch (caught) {
    const code = caught instanceof Error ? caught.message : "";
    error = [
      "unsafe_target",
      "timeout",
      "network_error",
      "response_error",
      "response_too_large",
    ].includes(code)
      ? code
      : "delivery_error";
  }
  await finishDelivery(pool, job, status, error);
  return true;
}
export async function replayDelivery(
  pool: pg.Pool,
  projectId: string,
  id: string,
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const row = (
      await client.query(
        `SELECT d.id,(d.status='inflight' AND d.locked_until>now()) AS busy FROM webhook_deliveries d JOIN webhook_endpoints h ON h.id=d.endpoint_id WHERE d.id=$1 AND h.project_id=$2 FOR UPDATE OF d`,
        [id, projectId],
      )
    ).rows[0];
    if (!row) {
      await client.query("COMMIT");
      return "not_found";
    }
    if (row.busy) {
      await client.query("COMMIT");
      return "busy";
    }
    await client.query(
      "UPDATE webhook_deliveries SET status='pending',cycle_started_at=now(),cycle_attempt_count=0,next_attempt_at=now(),lease_token=NULL,locked_until=NULL,delivered_at=NULL,replay_count=replay_count+1 WHERE id=$1",
      [id],
    );
    await client.query(
      "INSERT INTO audit_logs(project_id,action,entity_id) VALUES($1,'webhook.replayed',$2)",
      [projectId, id],
    );
    await client.query("COMMIT");
    return "replayed";
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
