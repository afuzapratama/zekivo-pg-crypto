CREATE TABLE transfer_reviews (
 transfer_id bigint PRIMARY KEY REFERENCES chain_transfers(id),
 status text NOT NULL CHECK(status IN ('open','in_progress','closed')),
 version integer NOT NULL CHECK(version > 0),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE transfer_review_actions (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 transfer_id bigint NOT NULL REFERENCES chain_transfers(id),
 environment text NOT NULL, cluster text NOT NULL,
 tenant_id uuid NOT NULL, object_id uuid NOT NULL, request_id uuid NOT NULL,
 request_hash text NOT NULL,
 from_status text NOT NULL, to_status text NOT NULL CHECK(to_status IN ('open','in_progress','closed')),
 version integer NOT NULL,
 reason text NOT NULL CHECK(length(reason) BETWEEN 10 AND 2000),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(environment,cluster,object_id,request_id),
 UNIQUE(transfer_id,version)
);
CREATE INDEX transfer_review_actions_history ON transfer_review_actions(transfer_id,id DESC);
CREATE INDEX chain_transfers_review_queue ON chain_transfers(environment,cluster,id DESC) WHERE disposition <> 'paid';
