ALTER TABLE scan_checkpoints ALTER COLUMN signature DROP NOT NULL;
ALTER TABLE scan_checkpoints ADD COLUMN scanned_through_slot bigint CHECK(scanned_through_slot>=0);
-- A recorded transfer is authoritative evidence for its transaction's slot.
UPDATE scan_checkpoints c SET scanned_through_slot=t.slot
FROM (SELECT environment,cluster,signature,max(slot) AS slot FROM chain_transfers GROUP BY environment,cluster,signature) t
WHERE c.environment=t.environment AND c.cluster=t.cluster AND c.signature=t.signature;
CREATE TABLE scan_history_gaps (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 environment text NOT NULL, cluster text NOT NULL, token_account text NOT NULL,
 previous_signature text, previous_slot bigint, first_available_slot bigint NOT NULL,
 recovered_through_slot bigint NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
