-- One deliberate payment scenario per playground invoice, including after restart/timeouts.
CREATE UNIQUE INDEX playground_one_action_per_invoice ON playground_actions(invoice_id);
