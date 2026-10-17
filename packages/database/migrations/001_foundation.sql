CREATE TABLE projects (
 id uuid PRIMARY KEY, name text NOT NULL, environment text NOT NULL CHECK(environment IN ('local','test','staging')), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE api_keys (
 id uuid PRIMARY KEY, project_id uuid NOT NULL REFERENCES projects(id), key_hash text NOT NULL UNIQUE, revoked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE invoices (
 id uuid PRIMARY KEY, project_id uuid NOT NULL REFERENCES projects(id), environment text NOT NULL,
 cluster text NOT NULL CHECK(cluster IN ('localnet','devnet')), asset text NOT NULL CHECK(asset IN ('USDT','USDC')),
 recipient text NOT NULL, mint text NOT NULL, order_id text NOT NULL,
 base_units bigint NOT NULL CHECK(base_units > 0), payable_units bigint NOT NULL CHECK(payable_units >= base_units),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','confirming','paid','expired')),
 checkout_token text NOT NULL UNIQUE, expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(project_id,order_id), UNIQUE(environment,cluster,mint,recipient,payable_units)
);
CREATE INDEX invoices_project_created ON invoices(project_id,created_at DESC);
CREATE TABLE idempotency_records (
 project_id uuid NOT NULL REFERENCES projects(id), key text NOT NULL, request_hash text NOT NULL,
 invoice_id uuid NOT NULL REFERENCES invoices(id), PRIMARY KEY(project_id,key)
);
CREATE TABLE audit_logs (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, project_id uuid REFERENCES projects(id),
 action text NOT NULL, entity_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
