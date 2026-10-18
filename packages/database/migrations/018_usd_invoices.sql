ALTER TABLE invoices ADD COLUMN price_currency text CHECK(price_currency='USD');
ALTER TABLE invoices ADD COLUMN price_amount text CHECK(price_amount ~ '^(0|[1-9][0-9]{0,9})\.[0-9]{2}$' AND price_amount::numeric>0);
ALTER TABLE invoices ADD COLUMN price_quotes jsonb;
ALTER TABLE invoices ADD COLUMN price_request jsonb;
ALTER TABLE invoices ADD CONSTRAINT invoice_usd_complete CHECK (
 (price_currency IS NULL AND price_amount IS NULL AND price_quotes IS NULL AND price_request IS NULL)
 OR (price_currency IS NOT NULL AND price_amount IS NOT NULL AND price_quotes IS NOT NULL AND price_request IS NOT NULL)
);
