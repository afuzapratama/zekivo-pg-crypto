CREATE TABLE token_configs (
 environment text NOT NULL, cluster text NOT NULL, asset text NOT NULL CHECK(asset IN ('USDT','USDC')),
 mint text NOT NULL, recipient text NOT NULL, token_account text NOT NULL, genesis_hash text NOT NULL,
 decimals integer NOT NULL CHECK(decimals=6), PRIMARY KEY(environment,cluster,asset),
 UNIQUE(environment,cluster,token_account)
);
ALTER TABLE invoices ADD COLUMN payment_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE invoices ADD COLUMN reference text UNIQUE;
CREATE TABLE chain_transfers (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 environment text NOT NULL, cluster text NOT NULL, signature text NOT NULL, instruction_path text NOT NULL,
 slot bigint NOT NULL, block_time timestamptz NOT NULL, mint text NOT NULL,
 destination text NOT NULL, amount bigint NOT NULL CHECK(amount>0),
 invoice_id uuid REFERENCES invoices(id), disposition text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(environment,cluster,signature,instruction_path)
);
CREATE TABLE ledger_entries (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, invoice_id uuid NOT NULL REFERENCES invoices(id),
 transfer_id bigint NOT NULL UNIQUE REFERENCES chain_transfers(id), amount bigint NOT NULL CHECK(amount>0),
 asset text NOT NULL, entry_type text NOT NULL CHECK(entry_type='payment'), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE webhook_events (
 event_id uuid PRIMARY KEY, invoice_id uuid NOT NULL REFERENCES invoices(id), event_type text NOT NULL,
 payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(invoice_id,event_type)
);
CREATE TABLE scan_checkpoints (
 environment text NOT NULL, cluster text NOT NULL, token_account text NOT NULL, signature text NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(environment,cluster,token_account)
);
