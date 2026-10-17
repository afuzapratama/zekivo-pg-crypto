-- Only local test tools write this table; production signing remains out of scope.
CREATE TABLE playground_actions (
 request_id uuid PRIMARY KEY,
 invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
 mode text NOT NULL CHECK(mode IN ('exact','manual','partial','overpaid')),
 status text NOT NULL CHECK(status IN ('pending','completed','unknown')),
 signature text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX playground_single_pending ON playground_actions ((true)) WHERE status='pending';
