CREATE TABLE reconciliation_control (
 environment text NOT NULL, cluster text NOT NULL,
 next_run_at timestamptz NOT NULL DEFAULT now(), cursor_id bigint NOT NULL DEFAULT 0,
 lease_token uuid, locked_until timestamptz,
 PRIMARY KEY(environment,cluster)
);
CREATE TABLE reconciliation_runs (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 environment text NOT NULL, cluster text NOT NULL,
 status text NOT NULL DEFAULT 'running' CHECK(status IN ('running','clean','findings','unavailable','failed','abandoned')),
 started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz,
 snapshot_at timestamptz, invoice_count bigint NOT NULL DEFAULT 0,
 finding_count bigint NOT NULL DEFAULT 0, chain_checked integer NOT NULL DEFAULT 0,
 chain_selected integer NOT NULL DEFAULT 0, chain_complete boolean NOT NULL DEFAULT false,
 cursor_start bigint NOT NULL, cursor_end bigint, cycle_completed boolean NOT NULL DEFAULT false,
 error_code text
);
CREATE INDEX reconciliation_runs_scope ON reconciliation_runs(environment,cluster,id DESC);
CREATE TABLE reconciliation_findings (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 run_id bigint NOT NULL REFERENCES reconciliation_runs(id),
 code text NOT NULL, entity_type text NOT NULL, entity_id text NOT NULL
);
CREATE INDEX reconciliation_findings_run ON reconciliation_findings(run_id,id);
CREATE TABLE operational_status (
 environment text NOT NULL, cluster text NOT NULL,
 component text NOT NULL CHECK(component IN ('api','scanner','reconciliation')),
 status text NOT NULL CHECK(status IN ('healthy','unhealthy','unknown','disabled')),
 reason_code text NOT NULL, consecutive_failures integer NOT NULL DEFAULT 0,
 last_checked_at timestamptz NOT NULL DEFAULT now(), last_success_at timestamptz,
 last_alert_at timestamptz, alert_seq bigint NOT NULL DEFAULT 0,
 PRIMARY KEY(environment,cluster,component)
);
CREATE TABLE monitor_heartbeats (
 environment text NOT NULL, cluster text NOT NULL, instance_id uuid NOT NULL,
 started_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(environment,cluster)
);
