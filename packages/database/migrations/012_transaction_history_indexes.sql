CREATE INDEX chain_transfers_scope_history ON chain_transfers(environment,cluster,id DESC);
CREATE INDEX chain_transfers_invoice_history ON chain_transfers(invoice_id,environment,cluster,block_time DESC,id DESC);
CREATE INDEX webhook_events_invoice_history ON webhook_events(invoice_id,created_at DESC,event_id DESC);
CREATE INDEX webhook_deliveries_event_history ON webhook_deliveries(event_id,id DESC);
