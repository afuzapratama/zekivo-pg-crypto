import type pg from "pg";
import {
  recordNotification,
  type NotificationScope,
} from "../../notifications/src/queue.js";
export async function writeOperationalStatus(
  c: pg.PoolClient,
  scope: NotificationScope,
  component: "api" | "scanner" | "reconciliation",
  healthy: boolean | null,
  reason: string,
  threshold = 3,
) {
  await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    `${scope.APP_ENV}:${scope.SOLANA_CLUSTER}:monitor:${component}`,
  ]);
  const previous = (
    await c.query(
      "SELECT *,last_alert_at<=now()-interval '1 hour' AS remind FROM operational_status WHERE environment=$1 AND cluster=$2 AND component=$3 FOR UPDATE",
      [scope.APP_ENV, scope.SOLANA_CLUSTER, component],
    )
  ).rows[0];
  const failures =
      healthy !== false ? 0 : Number(previous?.consecutive_failures ?? 0) + 1,
    status =
      healthy === null
        ? "disabled"
        : healthy
          ? "healthy"
          : failures >= threshold
            ? "unhealthy"
            : "unknown";
  const alert =
    (status === "unhealthy" &&
      (previous?.status !== "unhealthy" || previous?.remind)) ||
    (status === "healthy" && previous?.status === "unhealthy");
  const seq = Number(previous?.alert_seq ?? 0) + (alert ? 1 : 0);
  await c.query(
    `INSERT INTO operational_status(environment,cluster,component,status,reason_code,consecutive_failures,last_success_at,last_alert_at,alert_seq)VALUES($1,$2,$3,$4,$5,$6,CASE WHEN $4='healthy' THEN now() END,CASE WHEN $7 THEN now() END,$8)ON CONFLICT(environment,cluster,component)DO UPDATE SET status=$4,reason_code=$5,consecutive_failures=$6,last_checked_at=now(),last_success_at=CASE WHEN $4='healthy' THEN now() ELSE operational_status.last_success_at END,last_alert_at=CASE WHEN $7 THEN now() ELSE operational_status.last_alert_at END,alert_seq=$8`,
    [
      scope.APP_ENV,
      scope.SOLANA_CLUSTER,
      component,
      status,
      reason,
      Math.min(failures, 1000000),
      Boolean(alert),
      seq,
    ],
  );
  if (alert)
    await recordNotification(
      c,
      scope,
      `monitor:${component}:${seq}`,
      status === "healthy" ? "monitor.recovered" : "monitor.alert",
      status === "healthy" ? `${component} pulih` : `Gangguan ${component}`,
      `Komponen ${component} · ${reason}. Periksa dashboard operasional. Status pembayaran tidak diubah.`,
    );
  return status;
}
export async function updateOperationalStatus(
  pool: pg.Pool,
  scope: NotificationScope,
  component: "api" | "scanner" | "reconciliation",
  healthy: boolean | null,
  reason: string,
  threshold = 3,
) {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const status = await writeOperationalStatus(
      c,
      scope,
      component,
      healthy,
      reason,
      threshold,
    );
    await c.query("COMMIT");
    return status;
  } catch (error) {
    await c.query("ROLLBACK");
    throw error;
  } finally {
    c.release();
  }
}
export async function probeApi(url: string, scope: NotificationScope) {
  try {
    const r = await fetch(new URL("/health", url), {
      redirect: "error",
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) return false;
    const d = (await r.json()) as Record<string, unknown>;
    return (
      d.status === "ok" &&
      d.service === "api" &&
      d.environment === scope.APP_ENV &&
      d.cluster === scope.SOLANA_CLUSTER
    );
  } catch {
    return false;
  }
}
export async function checkUptime(
  pool: pg.Pool,
  scope: NotificationScope,
  apiOk: boolean,
  monitoring: boolean,
) {
  await updateOperationalStatus(
    pool,
    scope,
    "api",
    apiOk,
    apiOk ? "api_reachable" : "api_unreachable",
  );
  const health = (
    await pool.query(
      "SELECT scanner_status,updated_at>now()-interval '120 seconds' AS recent FROM worker_health WHERE environment=$1 AND cluster=$2",
      [scope.APP_ENV, scope.SOLANA_CLUSTER],
    )
  ).rows[0];
  const ok =
    !monitoring ||
    Boolean(health?.recent && health.scanner_status === "healthy");
  await updateOperationalStatus(
    pool,
    scope,
    "scanner",
    monitoring ? ok : null,
    !monitoring
      ? "monitoring_disabled"
      : !health
        ? "scanner_not_reported"
        : !health.recent
          ? "scanner_heartbeat_stale"
          : health.scanner_status !== "healthy"
            ? "scanner_reported_failure"
            : "scanner_current",
  );
}
