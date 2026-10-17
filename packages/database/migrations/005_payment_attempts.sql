ALTER TABLE invoices ADD COLUMN invoice_version integer NOT NULL DEFAULT 1 CHECK(invoice_version>0);
CREATE TABLE payment_attempts (
 id uuid PRIMARY KEY,
 invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
 environment text NOT NULL, cluster text NOT NULL,
 asset text NOT NULL CHECK(asset IN ('USDT','USDC')),
 recipient text NOT NULL, mint text NOT NULL, reference text UNIQUE,
 base_units bigint NOT NULL CHECK(base_units>0),
 payable_units bigint NOT NULL CHECK(payable_units>=base_units),
 payment_enabled boolean NOT NULL,
 created_at timestamptz NOT NULL, expires_at timestamptz NOT NULL,
 activated_at timestamptz,
 UNIQUE(invoice_id,asset),
 UNIQUE(environment,cluster,mint,recipient,payable_units)
);
-- Preserve all historical reservations, including disabled foundation invoices.
INSERT INTO payment_attempts
 SELECT id,id,environment,cluster,asset,recipient,mint,reference,base_units,payable_units,
 payment_enabled,created_at,expires_at,created_at FROM invoices;
ALTER TABLE chain_transfers ADD COLUMN attempt_id uuid REFERENCES payment_attempts(id);
UPDATE chain_transfers SET attempt_id=invoice_id WHERE invoice_id IS NOT NULL;
CREATE UNIQUE INDEX ledger_one_payment_per_invoice ON ledger_entries(invoice_id) WHERE entry_type='payment';
