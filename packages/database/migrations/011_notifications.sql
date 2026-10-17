CREATE TABLE notification_channels (
 environment text NOT NULL, cluster text NOT NULL,
 channel text NOT NULL CHECK(channel IN ('email','telegram')),
 enabled boolean NOT NULL DEFAULT false, config_ciphertext text NOT NULL,
 version integer NOT NULL DEFAULT 1, updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(environment,cluster,channel)
);
CREATE TABLE notification_sources (
 environment text NOT NULL, cluster text NOT NULL, started_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(environment,cluster)
);
CREATE TABLE notification_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 environment text NOT NULL, cluster text NOT NULL, source_key text NOT NULL,
 event_type text NOT NULL, title text NOT NULL, body text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(environment,cluster,source_key)
);
CREATE TABLE notification_deliveries (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 event_id bigint NOT NULL REFERENCES notification_events(id),
 channel text NOT NULL CHECK(channel IN ('email','telegram')),
 status text NOT NULL DEFAULT 'waiting_configuration' CHECK(status IN ('waiting_configuration','pending','inflight','sent','dead','expired')),
 attempt_count integer NOT NULL DEFAULT 0, next_attempt_at timestamptz NOT NULL DEFAULT now(),
 lease_token uuid, locked_until timestamptz, last_error text, sent_at timestamptz,
 expires_at timestamptz NOT NULL DEFAULT now()+interval '24 hours',
 UNIQUE(event_id,channel)
);
CREATE INDEX notification_delivery_queue ON notification_deliveries(status,next_attempt_at,id);
CREATE TABLE notification_attempts (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, delivery_id bigint NOT NULL REFERENCES notification_deliveries(id),
 attempt_no integer NOT NULL, started_at timestamptz NOT NULL DEFAULT now(),finished_at timestamptz,error_code text,
 UNIQUE(delivery_id,attempt_no)
);
CREATE TABLE worker_health (
 environment text NOT NULL, cluster text NOT NULL,
 scanner_status text NOT NULL CHECK(scanner_status IN ('healthy','failed','disabled')),
 last_success_at timestamptz,last_error_at timestamptz,updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(environment,cluster)
);
