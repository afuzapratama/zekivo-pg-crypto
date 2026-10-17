CREATE TABLE webhook_endpoints (
 id uuid PRIMARY KEY, project_id uuid NOT NULL REFERENCES projects(id), url text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('external','local_inbox')), secret_ciphertext text NOT NULL,
 active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(project_id,url)
);
CREATE TABLE webhook_deliveries (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 event_id uuid NOT NULL REFERENCES webhook_events(event_id), endpoint_id uuid NOT NULL REFERENCES webhook_endpoints(id),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','inflight','delivered','dead')),
 attempt_count integer NOT NULL DEFAULT 0, cycle_attempt_count integer NOT NULL DEFAULT 0,
 replay_count integer NOT NULL DEFAULT 0, cycle_started_at timestamptz NOT NULL DEFAULT now(),
 next_attempt_at timestamptz NOT NULL DEFAULT now(), lease_token uuid, locked_until timestamptz,
 last_http_status integer, last_error text, delivered_at timestamptz,
 UNIQUE(event_id,endpoint_id)
);
CREATE INDEX webhook_deliveries_due ON webhook_deliveries(status,next_attempt_at,locked_until);
CREATE TABLE webhook_attempts (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, delivery_id bigint NOT NULL REFERENCES webhook_deliveries(id),
 attempt_no integer NOT NULL, started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz,
 http_status integer, error_code text, UNIQUE(delivery_id,attempt_no)
);
-- Local merchant demo data: receipt and order fulfillment are committed atomically.
CREATE TABLE demo_webhook_receipts (
 event_id uuid PRIMARY KEY, project_id uuid NOT NULL REFERENCES projects(id), invoice_id uuid NOT NULL,
 payload_hash text NOT NULL, payload jsonb NOT NULL, signature_verified boolean NOT NULL DEFAULT true,
 received_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE demo_merchant_orders (
 project_id uuid NOT NULL REFERENCES projects(id), order_id text NOT NULL, invoice_id uuid NOT NULL,
 last_version integer NOT NULL, status text NOT NULL CHECK(status IN ('pending','paid','expired')),
 fulfillment_count integer NOT NULL DEFAULT 0 CHECK(fulfillment_count IN (0,1)),
 PRIMARY KEY(project_id,order_id)
);
