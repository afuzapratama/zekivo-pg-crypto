ALTER TABLE webhook_events DROP CONSTRAINT webhook_events_invoice_id_event_type_key;
CREATE UNIQUE INDEX webhook_one_terminal_event ON webhook_events(invoice_id,event_type)
 WHERE event_type IN ('payment.confirmed','payment.expired');
CREATE UNIQUE INDEX webhook_transfer_event ON webhook_events(invoice_id,event_type,(payload->'data'->>'transfer_id'))
 WHERE event_type IN ('payment.partial','payment.overpaid','payment.late','payment.review_required');
