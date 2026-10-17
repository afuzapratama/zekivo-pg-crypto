-- Admin identity/session data is separate from merchant API credentials.
CREATE TABLE admin_login_requests (
 token_hash text PRIMARY KEY,
 environment text NOT NULL,
 cluster text NOT NULL,
 state text NOT NULL,
 nonce text NOT NULL,
 verifier text NOT NULL,
 expires_at timestamptz NOT NULL
);
CREATE TABLE admin_sessions (
 token_hash text PRIMARY KEY,
 environment text NOT NULL,
 cluster text NOT NULL,
 tenant_id uuid NOT NULL,
 object_id uuid NOT NULL,
 csrf_token text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL,
 revoked_at timestamptz
);
CREATE INDEX admin_sessions_expiry ON admin_sessions(expires_at);
CREATE TABLE admin_audit_logs (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 environment text NOT NULL,
 cluster text NOT NULL,
 tenant_id uuid,
 object_id uuid,
 action text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
