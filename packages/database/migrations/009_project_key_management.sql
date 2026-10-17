ALTER TABLE api_keys ADD COLUMN name varchar(128) NOT NULL DEFAULT 'Legacy API key';
ALTER TABLE api_keys ADD COLUMN key_prefix varchar(32);
ALTER TABLE admin_sessions ADD COLUMN authenticated_at timestamptz;
ALTER TABLE admin_audit_logs ADD COLUMN project_id uuid REFERENCES projects(id);
ALTER TABLE admin_audit_logs ADD COLUMN entity_id text;
CREATE TABLE admin_mutations (
 environment text NOT NULL, cluster text NOT NULL, object_id uuid NOT NULL,
 request_id uuid NOT NULL, request_hash text NOT NULL, entity_id uuid NOT NULL,
 action text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(environment,cluster,object_id,request_id)
);
CREATE INDEX api_keys_project_created ON api_keys(project_id,created_at DESC,id DESC);
