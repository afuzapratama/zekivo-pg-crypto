CREATE TABLE manual_refunds (
 id uuid PRIMARY KEY,
 invoice_id uuid NOT NULL REFERENCES invoices(id),
 environment text NOT NULL, cluster text NOT NULL,
 asset text NOT NULL CHECK(asset IN ('USDT','USDC')),
 mint text NOT NULL, source_account text NOT NULL,
 destination text NOT NULL, destination_account text NOT NULL,
 amount bigint NOT NULL CHECK(amount>0),
 signature text NOT NULL, instruction_path text NOT NULL,
 slot bigint NOT NULL, block_time timestamptz NOT NULL,
 reason text NOT NULL CHECK(length(reason) BETWEEN 10 AND 2000),
 destination_verification text NOT NULL CHECK(length(destination_verification) BETWEEN 10 AND 1000),
 tenant_id uuid NOT NULL, object_id uuid NOT NULL,
 request_id uuid NOT NULL, request_hash text NOT NULL,
 verified_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(environment,cluster,signature,instruction_path),
 UNIQUE(environment,cluster,object_id,request_id)
);
CREATE INDEX manual_refunds_invoice ON manual_refunds(invoice_id,verified_at DESC,id DESC);
