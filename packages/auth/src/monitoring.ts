import type pg from "pg";
import type { FastifyInstance } from "fastify";
export function adminMonitoringRoutes(
  app: FastifyInstance,
  pool: pg.Pool,
  scope: { APP_ENV: string; SOLANA_CLUSTER: string },
) {
  app.get<{ Querystring: { before_run?: string; run_id?: string } }>(
    "/monitoring",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            before_run: { type: "string", pattern: "^[0-9]{1,18}$" },
            run_id: { type: "string", pattern: "^[0-9]{1,18}$" },
          },
        },
      },
    },
    async (req, reply) => {
      const env = [scope.APP_ENV, scope.SOLANA_CLUSTER];
      const [statuses, heartbeat, control, runs, selected] = await Promise.all([
        pool.query(
          "SELECT component,status,reason_code,consecutive_failures,last_checked_at,last_success_at,last_alert_at,last_checked_at>now()-(CASE WHEN component='reconciliation' THEN interval '30 minutes' ELSE interval '120 seconds' END) AS recent FROM operational_status WHERE environment=$1 AND cluster=$2 ORDER BY component",
          env,
        ),
        pool.query(
          "SELECT started_at,updated_at,updated_at>now()-interval '120 seconds' AS recent FROM monitor_heartbeats WHERE environment=$1 AND cluster=$2",
          env,
        ),
        pool.query(
          "SELECT next_run_at,cursor_id::text,locked_until FROM reconciliation_control WHERE environment=$1 AND cluster=$2",
          env,
        ),
        pool.query(
          "SELECT id::text,status,started_at,finished_at,invoice_count::text,finding_count::text,chain_checked,chain_selected,chain_complete,cycle_completed,error_code FROM reconciliation_runs WHERE environment=$1 AND cluster=$2 AND ($3::bigint IS NULL OR id<$3)ORDER BY reconciliation_runs.id DESC LIMIT 26",
          [...env, req.query.before_run ?? null],
        ),
        pool.query(
          "SELECT id::text,status,started_at,finished_at,snapshot_at,invoice_count::text,finding_count::text,chain_checked,chain_selected,chain_complete,cursor_start::text,cursor_end::text,cycle_completed,error_code FROM reconciliation_runs WHERE environment=$1 AND cluster=$2 AND ($3::bigint IS NULL OR id=$3)ORDER BY reconciliation_runs.id DESC LIMIT 1",
          [...env, req.query.run_id ?? null],
        ),
      ]);
      if (req.query.run_id && !selected.rowCount)
        return reply.code(404).send({ error: "not_found" });
      const run = selected.rows[0] ?? null,
        findings = run
          ? (
              await pool.query(
                "SELECT code,entity_type,entity_id FROM reconciliation_findings WHERE run_id=$1 ORDER BY id LIMIT 100",
                [run.id],
              )
            ).rows
          : [];
      return {
        components: statuses.rows,
        monitor: heartbeat.rows[0] ?? null,
        schedule: control.rows[0] ?? null,
        runs: runs.rows.slice(0, 25),
        next_cursor: runs.rows.length > 25 ? runs.rows[24]!.id : null,
        selected: run,
        findings,
        samples_truncated: run
          ? BigInt(run.finding_count) > BigInt(findings.length)
          : false,
      };
    },
  );
}
